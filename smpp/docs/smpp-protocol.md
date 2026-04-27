# SMPP Server (Inbound) — Protocol Handling

Phần này nói về **SMPP server** trong `smpp-server` service: nhận bind từ partner ESME, xử lý `submit_sm`, gửi lại `deliver_sm` (DLR). KHÔNG phải SMPP client tới telco (xem `dispatchers.md` mục `TelcoSmppDispatcher`).

Tham chiếu chuẩn: SMPP 3.4 specification.

---

## 1. Library

- **jSMPP** `org.jsmpp:jsmpp:3.0.0+`.
- Ưu điểm: thread-per-session model, API trực quan, doc nhiều.
- Nhược điểm: không hot async (Netty-based) → throughput tối đa ~vài trăm msg/s/session. Phase 1 OK.

Khi cần >5000 msg/s/session: chuyển sang Cloudhopper (xem ADR mới khi đó).

---

## 2. Listener bootstrap

`smpp-server/src/main/java/vn/vihat/smpp/server/smpp/SmppServerConfig.java`:

```java
@Configuration
public class SmppServerConfig {

    @Bean(destroyMethod = "close")
    public SMPPServerSessionListener listener(
        @Value("${app.smpp.server.port}") int port,
        BindAuthenticator authenticator,
        MessageReceiverListenerImpl receiver,
        ServerResponseDeliveryAdapter adapter,
        TaskExecutor smppExecutor
    ) throws IOException {
        SMPPServerSessionListener l = new SMPPServerSessionListener(port);
        l.setSessionStateListener(...);
        new Thread(() -> acceptLoop(l, authenticator, receiver, smppExecutor), "smpp-accept").start();
        return l;
    }

    private void acceptLoop(SMPPServerSessionListener l, ...) {
        while (!l.isClosed()) {
            try {
                SMPPServerSession session = l.accept();   // blocking
                session.setMessageReceiverListener(receiver);
                session.setEnquireLinkTimer(30_000);
                session.setSequenceNumberScheme(...);
                // bind sẽ trigger BindAuthenticator qua receiver.onAcceptBind()
            } catch (Exception e) {
                if (l.isClosed()) return;
                log.warn("accept failed", e);
            }
        }
    }
}
```

`smppExecutor` là một bean `ThreadPoolTaskExecutor` riêng cho SMPP I/O (không dùng common pool):
```yaml
app.smpp.executor.core-size: 32
app.smpp.executor.max-size: 128
app.smpp.executor.queue-capacity: 256
```

Java 21 virtual threads: có thể dùng `Executors.newVirtualThreadPerTaskExecutor()` để handle hàng nghìn session với memory thấp. Quyết định cuối khi benchmark phase 3.

---

## 3. Bind flow

Partner gửi `bind_transmitter` / `bind_receiver` / `bind_transceiver`:

```
ESME ──bind_xxx (system_id, password, system_type, ip)──► smpp-server
                                                              │
                                                              ▼
                                              BindAuthenticator.authenticate(...)
                                                              │
                                              ┌───────────────┼───────────────┐
                                          OK  │               │               │
                                              │           system_id sai       password sai
                                              ▼               │               │
                                  SessionRegistry.add(...)    ▼               ▼
                                              │       ESME_RBINDFAIL    ESME_RBINDFAIL
                                              ▼                                
                                  bind_xxx_resp (status=0)
                                  → session ACTIVE
```

`auth/BindAuthenticator.java`:
```java
public BindResult authenticate(String systemId, String password, String sourceIp) {
    PartnerSmppAccount acc = repo.findBySystemId(systemId)
        .orElseThrow(() -> new BindRejected(STAT_ESME_RBINDFAIL, "unknown system_id"));

    if (!"ACTIVE".equals(acc.getStatus())) throw new BindRejected(...);

    // Bcrypt verify (cache positive result 5 phút trong Redis để tránh CPU)
    String cacheKey = "smpp:bindok:" + systemId + ":" + sha256(password);
    if (!redis.exists(cacheKey)) {
        if (!passwordHasher.matches(password, acc.getPasswordHash())) {
            throw new BindRejected(STAT_ESME_RBINDFAIL, "bad password");
        }
        redis.set(cacheKey, "1", Duration.ofMinutes(5));
    }

    if (!ipWhitelistOk(sourceIp, acc.getIpWhitelist())) {
        throw new BindRejected(STAT_ESME_RBINDFAIL, "ip not whitelisted");
    }

    int activeBinds = sessionRegistry.countActive(systemId);
    if (activeBinds >= acc.getMaxBinds()) {
        throw new BindRejected(STAT_ESME_RTHROTTLED, "max binds reached");
    }

    return new BindResult(acc);
}
```

IP whitelist check: với mỗi CIDR trong `acc.ip_whitelist` (jsonb array), check `cidr.contains(sourceIp)`. Empty array = allow all.

---

## 4. Session registry

`smpp/SessionRegistry.java` — singleton in-memory + sync sang Redis cho admin observability:

```java
@Component
public class SessionRegistry {
    private final ConcurrentMap<String, Set<SMPPServerSession>> bySystemId = new ConcurrentHashMap<>();
    private final RedisTemplate<String, String> redis;

    public void add(String systemId, SMPPServerSession session) {
        bySystemId.computeIfAbsent(systemId, k -> ConcurrentHashMap.newKeySet()).add(session);
        redis.opsForHash().put("smpp:session:" + systemId, sessionId(session), nowIso());
    }

    public void remove(SMPPServerSession session) {
        String systemId = ...;
        bySystemId.computeIfPresent(systemId, (k, v) -> { v.remove(session); return v.isEmpty() ? null : v; });
        redis.opsForHash().delete("smpp:session:" + systemId, sessionId(session));
    }

    public int countActive(String systemId) { return bySystemId.getOrDefault(systemId, Set.of()).size(); }

    public Collection<SMPPServerSession> get(String systemId) { return bySystemId.getOrDefault(systemId, Set.of()); }

    public List<SessionInfo> listAll() { /* dùng cho /api/admin/sessions */ }
}
```

Khi admin gọi `POST /api/admin/sessions/{system_id}/kick` → `sessionRegistry.get(systemId).forEach(SMPPServerSession::unbindAndClose)`.

---

## 5. `submit_sm` handler

`MessageReceiverListenerImpl.onAcceptSubmitSm(...)`:

```java
@Override
public SubmitSmResult onAcceptSubmitSm(SubmitSm submitSm, SMPPServerSession session) throws ProcessRequestException {
    String systemId = session.getSessionId();   // jSMPP exposes systemId via state
    PartnerSmppAccount acc = ...; // từ session attribute

    // 1. Validate
    if (submitSm.getShortMessage().length > 140) {
        throw new ProcessRequestException("body too long", SMPPConstant.STAT_ESME_RINVMSGLEN);
    }
    String destAddr = normalize(submitSm.getDestAddress().getAddress());
    String sourceAddr = submitSm.getSourceAddress().getAddress();
    String content = decodeContent(submitSm.getShortMessage(), submitSm.getDataCoding());

    // 2. Throttle
    if (!throttler.tryAcquire("smpp:throttle:" + systemId, acc.getThroughputPerSecond())) {
        throw new ProcessRequestException("throttled", SMPPConstant.STAT_ESME_RTHROTTLED);
    }

    // 3. Save DB (state=RECEIVED)
    Message msg = new Message();
    msg.setId(UUID.randomUUID());
    msg.setPartnerId(acc.getPartnerId());
    msg.setSourceAddr(sourceAddr);
    msg.setDestAddr(destAddr);
    msg.setContent(content);
    msg.setEncoding(encodingOf(submitSm.getDataCoding()));
    msg.setInboundVia("SMPP");
    msg.setState("RECEIVED");
    messageRepo.save(msg);

    // 4. Publish AMQP sms.inbound
    publisher.publish(Exchanges.SMS_INBOUND, RoutingKeys.partner(acc.getPartnerId()),
        new InboundMessageEvent(msg.getId(), acc.getPartnerId(), sourceAddr, destAddr,
            content, msg.getEncoding(), "SMPP", null));

    // 5. Trả message_id (chuẩn SMPP: ≤65 octets, alphanumeric)
    return new SubmitSmResult(messageIdAsString(msg.getId()), null);
}
```

Trả `message_id` là Crockford base32 của UUID (25 chars) — partner có thể dùng để query DLR sau, và để khớp `message_id` trong `deliver_sm` DLR PDU sau đó.

---

## 6. Encoding handling

SMPP `data_coding` (DCS) phổ biến:
- `0x00` — GSM7 default alphabet (160 chars / 140 bytes packed).
- `0x03` — Latin-1 / ISO-8859-1.
- `0x08` — UCS-2 BE (70 chars / 140 bytes).

`smpp-server/.../EncodingUtils.java`:
```java
public static String decode(byte[] payload, byte dcs) {
    return switch (dcs & 0x0F) {
        case 0x00 -> Gsm7Codec.decode(payload);   // dùng helper riêng
        case 0x03 -> new String(payload, StandardCharsets.ISO_8859_1);
        case 0x08 -> new String(payload, StandardCharsets.UTF_16BE);
        default   -> new String(payload, StandardCharsets.US_ASCII);  // fallback an toàn
    };
}
```

GSM7 packed unpack: jSMPP có `org.jsmpp.util.DefaultDecomposer` hoặc tự implement (xem chuẩn 3GPP TS 23.038).

**Phase 1 chỉ hỗ trợ single-PDU** (≤140 bytes). UDH multi-segment (long SMS reassembly) ngoài scope, sẽ thêm trong phase tương lai (cập nhật ADR).

---

## 7. Throttling

`smpp/SmppThrottler.java` dùng Redis token bucket:

```
Key: smpp:throttle:<system_id>
Bucket size: throughput_per_second (default 100)
Refill: 1 token / 10ms (= 100/s)
```

Implementation đơn giản: `INCR + EXPIRE 1s`. Nếu count > limit → throttle.

Chính xác hơn: dùng Lua script `CL.THROTTLE` (Redis cell module) hoặc Bucket4J + Redisson.

---

## 8. Enquire link & timeouts

- Default `enquire_link` interval: 30s (config `app.smpp.server.enquire-link-interval`).
- Session idle >120s → server gửi enquire_link, no resp → close.
- `session.setTransactionTimer(10_000)` — chờ resp PDU max 10s.

---

## 9. `deliver_sm` (DLR forward về partner)

`outbound/DlrForwarder.java` consume `sms.dlr`:

```java
@RabbitListener(queues = SMS_DLR_Q)
public void onDlr(DlrEvent evt) {
    Collection<SMPPServerSession> sessions = sessionRegistry.activeForPartner(evt.partnerId());
    if (!sessions.isEmpty()) {
        SMPPServerSession s = pickAnySession(sessions);   // round-robin nếu nhiều
        try {
            String dlrText = buildDlrText(evt);   // "id:abc sub:001 dlvrd:001 stat:DELIVRD ..."
            s.deliverShortMessage(
                "",                                              // service_type
                TypeOfNumber.UNKNOWN, NumberingPlanIndicator.UNKNOWN, evt.destAddr(),
                TypeOfNumber.UNKNOWN, NumberingPlanIndicator.UNKNOWN, evt.sourceAddr(),
                new ESMClass(MessageMode.DEFAULT, MessageType.SMSC_DEL_RECEIPT, GSMSpecificFeature.DEFAULT),
                (byte) 0, (byte) 0, new RegisteredDelivery(SMSCDeliveryReceipt.DEFAULT),
                DataCoding.newInstance(0), dlrText.getBytes(StandardCharsets.US_ASCII)
            );
            return;
        } catch (Exception e) { log.warn("deliver_sm failed, fallback to webhook", e); }
    }

    // Fallback webhook
    if (StringUtils.isNotBlank(evt.partnerWebhookUrl())) {
        webhookSender.sendDlr(evt);   // có queue retry riêng
    }
    // Else: chỉ lưu DB, partner pull
}
```

DLR text format chuẩn SMPP 3.4:
```
id:<message_id_25chars> sub:001 dlvrd:001 submit date:YYMMDDhhmm done date:YYMMDDhhmm stat:DELIVRD err:000 text:<first 20 chars>
```

`stat` values: `DELIVRD`, `EXPIRED`, `UNDELIV`, `REJECTD`, `ACCEPTD`, `UNKNOWN`.

---

## 10. Logging key

Mọi log liên quan SMPP có MDC:
- `systemId`
- `messageId`
- `partnerId`
- `sourceIp`
- `pduType` (bind_xxx, submit_sm, deliver_sm, ...)

Ví dụ logback pattern:
```
%d{HH:mm:ss.SSS} [%thread] %-5level [smpp pid=%X{partnerId} msg=%X{messageId}] %logger - %msg%n
```

---

## 11. Tests gợi ý

- Unit: `BindAuthenticator` với mock repo.
- Integration: launch jSMPP test client trong JUnit, bind giả lập, submit_sm, assert DB row + AMQP message.
- E2E manual: smppcli (npm package).

---

## 12. Câu hỏi tương lai (cập nhật ADR khi quyết)

- Hỗ trợ SMPP 5.0? (hiện 3.4 đủ cho VN)
- TLS over SMPP (port 3550)? Phase 1 chỉ plain TCP 2775.
- Multi-segment SMS (UDH)?
- Số session per partner > 5? Tăng default lên 20?
