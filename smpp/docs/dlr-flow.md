# DLR Flow — Ingress + Forward

DLR (Delivery Report) là tin nhắn xác nhận trạng thái cuối cùng (DELIVERED/FAILED/EXPIRED) từ phía nhận. Vòng đời gồm 2 phase:
1. **Ingress**: nhận DLR từ telco/3rd-party/FreeSWITCH, lưu DB.
2. **Forward**: trả DLR về cho partner ban đầu (SMPP `deliver_sm` hoặc HTTP webhook).

---

## 1. Tổng quan

```
[Telco SMPP]   deliver_sm DLR ──┐
[3rd-party]    HTTP webhook ────┼──► DlrIngressHandler ──► save DB ──► publish sms.dlr
[FreeSWITCH]   ESL event ──────┘                                              │
                                                                              ▼
                                                              DlrForwarder (smpp-server)
                                                                              │
                                                          ┌───────────────────┼──────────────────┐
                                                  partner có session SMPP?    │   webhook?       │
                                                          │                   │                  │
                                                         yes                  no              giữ DB
                                                          │                   │
                                                          ▼                   ▼
                                                  deliver_sm tới        POST JSON tới
                                                  partner session       partner.dlr_webhook_url
```

---

## 2. Ingress sources

### 2.1 Telco SMPP `deliver_sm`

Sống trong worker, lớp `TelcoDeliverSmHandler` (đã mô tả `dispatchers.md` mục 3.6). Handler trong cùng session client SMPP với telco.

`deliver_sm` có 2 dạng:
- **DLR thực sự**: ESM class flag `MessageType.SMSC_DEL_RECEIPT`. Body là delivery receipt format text.
- **MO message** (mobile-originated, partner gửi tin lên): không có DLR flag. Phase 1 bỏ qua MO (chưa support inbound 2 chiều cho partner).

Parse DLR text bằng `DeliveryReceipt` của jSMPP:
```
id:abc123 sub:001 dlvrd:001 submit date:2604271200 done date:2604271205 stat:DELIVRD err:000 text:Hello
```

Trường quan trọng:
- `id` — telco message ID, map về `message.message_id_telco`.
- `stat` — status code (DELIVRD/EXPIRED/UNDELIV/REJECTD/ACCEPTD/UNKNOWN).
- `err` — error code 3 chữ số.

### 2.2 3rd-party HTTP webhook

3rd-party gọi `POST /api/internal/dlr/{channel_id}` (host: `smpp-server`).

Authentication: shared secret trong `channel.config`:
```json
{
  "webhook_secret": "abc123",
  "webhook_secret_header": "X-Webhook-Secret",
  "webhook_allowed_ips": ["1.2.3.0/24"],
  "webhook_payload_mapping": {
    "external_id_path": "$.message_id",
    "status_path": "$.status",
    "status_delivered_values": ["delivered","sent_ok"],
    "status_failed_values": ["failed","rejected","expired"],
    "error_code_path": "$.error_code"
  }
}
```

Handler trong smpp-server:
```java
@RestController
@RequestMapping("/api/internal/dlr")
public class InternalDlrController {
    @PostMapping("/{channelId}")
    public ResponseEntity<Void> ingress(
        @PathVariable long channelId,
        @RequestBody String rawBody,
        HttpServletRequest req
    ) {
        Channel ch = channelRepo.findById(channelId).orElseThrow();
        verifyAuth(ch, req);   // header secret + IP allowlist

        Map<String,Object> payload = json.readValue(rawBody, Map.class);
        String extId = jsonPath(payload, ch.config().externalIdPath());
        String status = jsonPath(payload, ch.config().statusPath());

        String state = mapStatus(status, ch.config());
        DlrEvent evt = new DlrEvent(extId, state, jsonPath(payload, ch.config().errorCodePath()),
                                    rawBody, "HTTP_WEBHOOK");

        // Publish AMQP để worker xử lý đồng nhất với DLR khác
        amqp.convertAndSend(Exchanges.SMS_DLR_INGRESS, "channel." + channelId, evt);
        return ResponseEntity.ok().build();
    }
}
```

Lý do publish AMQP thay vì xử lý trực tiếp: để DLR pipeline thống nhất (cũng từ telco). Worker consume `sms.dlr.ingress.q`.

### 2.3 FreeSWITCH ESL event

Sống trong worker, lớp `ChannelHangupHandler` (đã mô tả `dispatchers.md` mục 2.6).

Map `Hangup-Cause`:
| Hangup cause | DLR state |
|---|---|
| `NORMAL_CLEARING`, `NORMAL_DISCONNECT` | DELIVERED |
| `NO_ANSWER`, `USER_BUSY`, `CALL_REJECTED` | FAILED |
| `ORIGINATOR_CANCEL` | FAILED |
| `NETWORK_OUT_OF_ORDER`, `RECOVERY_ON_TIMER_EXPIRE` | FAILED (retryable nội bộ?) |
| anything else | FAILED |

Phase 1 không retry voice OTP (xem `routing.md`), nên mọi non-DELIVERED → FAILED final.

---

## 3. `DlrIngressHandler` (worker)

Một entry point duy nhất, được gọi từ 3 nguồn trên.

```java
@Component
public class DlrIngressHandler {
    private final MessageRepository msgRepo;
    private final DlrRepository dlrRepo;
    private final RabbitTemplate amqp;

    @Transactional
    public void handle(DlrEvent evt) {
        // 1. Lookup message qua message_id_telco hoặc message_id (UUID)
        Message msg = lookup(evt);
        if (msg == null) {
            log.warn("DLR for unknown message: extId={} source={}", evt.externalId(), evt.source());
            // Lưu vào "orphan_dlr" table hoặc bỏ qua. Phase 1: bỏ qua + log.
            return;
        }

        // 2. Insert dlr row
        Dlr dlr = new Dlr();
        dlr.setMessageId(msg.id());
        dlr.setState(evt.state());
        dlr.setErrorCode(evt.errorCode());
        dlr.setRawPayload(evt.rawPayload());
        dlr.setSource(evt.source());
        dlrRepo.save(dlr);

        // 3. Update message state (chỉ nếu state hiện tại là SUBMITTED → tránh transition ngược)
        if ("SUBMITTED".equals(msg.state())) {
            msg.setState(evt.state());
            msgRepo.save(msg);
        }

        // 4. Publish sms.dlr cho smpp-server forward về partner
        amqp.convertAndSend(Exchanges.SMS_DLR, RoutingKeys.partner(msg.partnerId()),
            new DlrForwardEvent(msg.id(), msg.partnerId(), msg.sourceAddr(), msg.destAddr(),
                                evt.state(), evt.errorCode(), msg.messageIdTelco()));
    }

    private Message lookup(DlrEvent evt) {
        // Try by external ID (message_id_telco) trước
        String cacheKey = "dlr:lookup:" + evt.externalId();
        UUID msgId = redis.get(cacheKey);
        if (msgId != null) return msgRepo.findById(msgId).orElse(null);

        Optional<Message> found = msgRepo.findByMessageIdTelco(evt.externalId());
        if (found.isPresent()) {
            redis.set(cacheKey, found.get().id().toString(), Duration.ofHours(1));
            return found.get();
        }

        // Fallback: external ID có thể là UUID nội bộ (vd FS event variable_origination_uuid = msg_id)
        try { return msgRepo.findById(UUID.fromString(evt.externalId())).orElse(null); }
        catch (IllegalArgumentException e) { return null; }
    }
}
```

---

## 4. `DlrForwarder` (smpp-server)

Consume `sms.dlr` queue:

```java
@Component
public class DlrForwarder {
    private final SessionRegistry sessionRegistry;
    private final WebhookSender webhookSender;
    private final PartnerRepository partnerRepo;

    @RabbitListener(queues = SMS_DLR_Q)
    public void onDlr(DlrForwardEvent evt) {
        // 1. Try SMPP deliver_sm trên session active
        Collection<SMPPServerSession> sessions = sessionRegistry.activeForPartner(evt.partnerId());
        if (!sessions.isEmpty()) {
            try {
                SMPPServerSession session = pickAnySession(sessions);   // round-robin
                sendDeliverSm(session, evt);
                log.info("DLR sent via SMPP session: msg={}", evt.messageId());
                return;
            } catch (Exception e) {
                log.warn("deliver_sm failed, fallback to webhook: {}", e.getMessage());
            }
        }

        // 2. Fallback: webhook
        Partner partner = partnerRepo.findById(evt.partnerId()).orElseThrow();
        if (StringUtils.isNotBlank(partner.dlrWebhookUrl())) {
            webhookSender.sendDlr(partner.dlrWebhookUrl(), evt);   // có retry queue
            return;
        }

        // 3. Else: chỉ lưu DB (đã lưu rồi ở DlrIngressHandler), partner pull qua API
        log.info("DLR persisted only (no session, no webhook): msg={}", evt.messageId());
    }

    private void sendDeliverSm(SMPPServerSession session, DlrForwardEvent evt) {
        String dlrText = String.format(
            "id:%s sub:001 dlvrd:001 submit date:%s done date:%s stat:%s err:%s text:",
            shortId(evt.messageId()),
            formatDate(evt.submittedAt()),
            formatDate(evt.deliveredAt()),
            mapStateToStatText(evt.state()),
            evt.errorCode() != null ? evt.errorCode() : "000"
        );
        session.deliverShortMessage(
            "",
            TypeOfNumber.UNKNOWN, NumberingPlanIndicator.UNKNOWN, evt.destAddr(),
            TypeOfNumber.UNKNOWN, NumberingPlanIndicator.UNKNOWN, evt.sourceAddr(),
            new ESMClass(MessageMode.DEFAULT, MessageType.SMSC_DEL_RECEIPT, GSMSpecificFeature.DEFAULT),
            (byte) 0, (byte) 0,
            new RegisteredDelivery(SMSCDeliveryReceipt.DEFAULT),
            DataCoding.newInstance(0),
            dlrText.getBytes(StandardCharsets.US_ASCII)
        );
    }
}
```

Map state → SMPP DLR status text:
| Internal state | SMPP stat |
|---|---|
| DELIVERED | DELIVRD |
| FAILED (timeout) | EXPIRED |
| FAILED (telco reject) | UNDELIV |
| FAILED (rejected by destination) | REJECTD |
| any other FAILED | UNKNOWN |

---

## 5. Webhook sender + retry

`WebhookSender`:

```java
@Component
public class WebhookSender {
    private final WebClient webClient;
    private final RabbitTemplate amqp;

    public void sendDlr(String url, DlrForwardEvent evt) {
        sendWithRetry(url, evt, 0);
    }

    private void sendWithRetry(String url, DlrForwardEvent evt, int attempt) {
        try {
            ResponseEntity<String> resp = webClient.post()
                .uri(url)
                .header("X-Webhook-Type", "DLR")
                .bodyValue(evt)
                .retrieve()
                .toEntity(String.class)
                .block(Duration.ofSeconds(10));
            if (resp.getStatusCode().is2xxSuccessful()) return;
            scheduleRetry(url, evt, attempt);
        } catch (Exception e) {
            scheduleRetry(url, evt, attempt);
        }
    }

    private void scheduleRetry(String url, DlrForwardEvent evt, int attempt) {
        if (attempt >= 3) {
            log.error("DLR webhook permanently failed after {} attempts: msg={} url={}",
                attempt, evt.messageId(), url);
            return;
        }
        long delayMs = switch (attempt) {
            case 0 -> 30_000;    // 30s
            case 1 -> 120_000;   // 2m
            default -> 600_000;  // 10m
        };
        // publish vào delay exchange
        amqp.convertAndSend(Exchanges.DLR_RETRY, "dlr.retry",
            new DlrRetryEvent(url, evt, attempt + 1),
            msg -> { msg.getMessageProperties().setHeader("x-delay", delayMs); return msg; });
    }
}
```

`Exchanges.DLR_RETRY` cần plugin RabbitMQ `rabbitmq_delayed_message_exchange`. Cài ở host RabbitMQ:
```bash
docker exec rabbitmq rabbitmq-plugins enable rabbitmq_delayed_message_exchange
```

(Ghi note vào `nginx.md` hoặc tạo file ops/ riêng. Phase 1: cập nhật `roadmap.md` step manual.)

---

## 6. Retry consumer

```java
@RabbitListener(queues = "dlr.retry.q")
public void onRetry(DlrRetryEvent retry) {
    webhookSender.sendWithRetry(retry.url(), retry.event(), retry.attempt());
}
```

---

## 7. Webhook payload format

POST tới `partner.dlr_webhook_url`:

```json
{
  "type": "dlr",
  "message_id": "01HZ8K3M9X8Q...",
  "client_ref": "partner-internal-id-1234",
  "source_addr": "VHT",
  "dest_addr": "84901234567",
  "state": "DELIVERED",
  "error_code": null,
  "external_message_id": "telco-abc123",
  "submitted_at": "2026-04-27T08:30:01Z",
  "delivered_at": "2026-04-27T08:30:08Z"
}
```

Header:
- `Content-Type: application/json`
- `X-Webhook-Type: DLR`
- `X-Signature: HMAC-SHA256(partner.webhook_secret, body)` — partner verify (phase tương lai, cần thêm cột `partner.webhook_secret`).

Phase 1 chưa sign webhook payload (đơn giản hóa). Cập nhật ADR khi thêm.

---

## 8. State transition + idempotency

DLR có thể đến nhiều lần (interim + final, redeliver từ telco). `DlrIngressHandler` insert mọi DLR vào bảng `dlr` (không unique constraint, giữ history). Update `message.state` chỉ khi:
- Hiện tại = `SUBMITTED`.
- DLR là final state (DELIVERED/FAILED/EXPIRED).

Interim DLR (vd ACCEPTED) → chỉ insert `dlr` table, không update `message.state`.

---

## 9. Edge cases

### 9.1 DLR đến trước response submit_sm

Telco có thể trả DLR trước khi `submit_sm_resp` về (race). `message.message_id_telco` chưa được set → DLR lookup fail → orphan.

Mitigation: lưu pending map trong worker `pendingTelcoSubmits = Map<msg_id_internal, msg_id_telco>` ngay khi gọi `submitShortMessage`. Khi DLR đến tra map ngược → save vào `message.message_id_telco` rồi continue.

### 9.2 DLR cho message không tồn tại

Có thể do lỗi telco (ID sai), hoặc message bị xóa retention. Phase 1: log warning + bỏ qua.

### 9.3 Webhook URL đổi giữa chừng

Webhook fail retry → `partner.dlr_webhook_url` đã đổi. Solution: capture URL tại thời điểm publish, KHÔNG re-read partner row. (Đã làm trong `DlrRetryEvent`).

### 9.4 Partner online nhưng không bind RECEIVER

Nếu partner bind chỉ TRANSMITTER (không receive được deliver_sm) → SMPP deliver_sm fail. Worker nên check session bind type:
```java
if (session.getBindType() == BindType.BIND_TX) skipSmppFallbackToWebhook();
```

---

## 10. Monitoring (phase 1: log)

- Mỗi DLR ingress log với `extId`, `state`, `source`, latency từ submit→DLR.
- Webhook fail rate: count log + manual grep.
- Phase 2+: Prometheus counter `dlr_ingress_total{source,state}`, `dlr_forward_total{method,outcome}`.
