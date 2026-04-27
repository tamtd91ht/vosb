# Dispatchers — 3 channel implementations

3 channel type tương ứng 3 `ChannelDispatcher` impl trong `worker/dispatch/`. Tất cả implement chung interface:

```java
public interface ChannelDispatcher {
    ChannelType supportedType();
    DispatchResult dispatch(Message msg, Channel ch);
}

public sealed interface DispatchResult {
    record Success(String externalMessageId, long latencyMs) implements DispatchResult {}
    record FailRetryable(String errorCode, String detail) implements DispatchResult {}
    record FailFinal(String errorCode, String detail) implements DispatchResult {}
}
```

`Success` → state=SUBMITTED. `FailRetryable` → caller có thể retry hoặc fallback. `FailFinal` → state=FAILED ngay, không retry/fallback.

---

## 1. `HttpThirdPartyDispatcher`

### 1.1 Vai trò

Forward message tới REST API của 3rd-party (vd Esms, Stringee, các aggregator khác).

### 1.2 Config jsonb

```json
{
  "url": "https://3rdparty.example.com/sms/send",
  "method": "POST",
  "headers": { "X-Custom": "value" },
  "auth_type": "BEARER" | "BASIC" | "HMAC" | "NONE",
  "auth_token": "<plaintext>",
  "signing_secret": "<plaintext>",
  "body_template": "{\"to\":\"${dest}\",\"text\":\"${content}\",\"from\":\"${source}\"}",
  "response_id_path": "$.data.message_id",
  "response_status_path": "$.data.status",
  "response_status_success_values": ["sent","accepted","ok"],
  "timeout_ms": 10000
}
```

`body_template` dùng StringSubstitutor (Apache commons-text), placeholder `${dest}`, `${source}`, `${content}`, `${msg_id}`. Có thể là JSON hoặc form-encoded (server detect bởi `headers.Content-Type`).

`response_id_path` / `response_status_path` dùng JsonPath để extract `external_message_id` (lưu vào `message.message_id_telco`) và status check.

### 1.3 Flow

```java
@Component
public class HttpThirdPartyDispatcher implements ChannelDispatcher {
    private final WebClient webClient;   // shared, reactive HTTP client

    @Override public ChannelType supportedType() { return ChannelType.HTTP_THIRD_PARTY; }

    @Override
    public DispatchResult dispatch(Message msg, Channel ch) {
        Config cfg = parse(ch.config());
        String body = render(cfg.bodyTemplate(), msg);

        try {
            ResponseEntity<String> resp = webClient.method(HttpMethod.valueOf(cfg.method()))
                .uri(cfg.url())
                .headers(h -> applyAuth(h, cfg))
                .bodyValue(body)
                .retrieve()
                .toEntity(String.class)
                .block(Duration.ofMillis(cfg.timeoutMs()));

            int code = resp.getStatusCode().value();
            if (code >= 500) return new FailRetryable("HTTP_5XX", "code=" + code);
            if (code >= 400) return new FailFinal("HTTP_4XX", "code=" + code);

            // 2xx
            String extId = jsonPath(resp.getBody(), cfg.responseIdPath());
            String status = jsonPath(resp.getBody(), cfg.responseStatusPath());
            if (cfg.responseStatusSuccessValues().contains(status.toLowerCase())) {
                return new Success(extId, latencyMs);
            }
            return new FailFinal("BAD_STATUS", "status=" + status);
        } catch (TimeoutException e) {
            return new FailRetryable("TIMEOUT", e.getMessage());
        } catch (Exception e) {
            return new FailRetryable("HTTP_ERROR", e.getMessage());
        }
    }
}
```

### 1.4 Auth modes

- **NONE**: không add header.
- **BEARER**: `Authorization: Bearer <auth_token>`.
- **BASIC**: `Authorization: Basic <base64(user:pass)>` (auth_token format `user:pass`).
- **HMAC**: tương tự partner inbound — sign `METHOD\nPATH\nTIMESTAMP\nBODY` với `signing_secret`. 3rd-party server verify.

### 1.5 Retry

Wrap dispatcher trong `RetryTemplate`:
```yaml
app.dispatch.http.retry.max-attempts: 3
app.dispatch.http.retry.initial-interval: 1s
app.dispatch.http.retry.multiplier: 3
```

Chỉ retry khi `FailRetryable`. `FailFinal` → trả ngay cho caller (caller thử fallback).

### 1.6 DLR ingress (webhook)

3rd-party gửi webhook lại khi delivery xong. Endpoint `POST /api/internal/dlr/{channel_id}` (host trong smpp-server) — xem `dlr-flow.md`.

### 1.7 Cấu hình WebClient

Shared bean (1 client cho tất cả channel HTTP):
```java
@Bean
WebClient webClient() {
    HttpClient http = HttpClient.create()
        .responseTimeout(Duration.ofSeconds(30))
        .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5000);
    return WebClient.builder()
        .clientConnector(new ReactorClientHttpConnector(http))
        .codecs(c -> c.defaultCodecs().maxInMemorySize(2 * 1024 * 1024))   // 2MB max body
        .build();
}
```

Per-request timeout override qua `cfg.timeoutMs()`.

---

## 2. `FreeSwitchEslDispatcher`

### 2.1 Vai trò

Originate cuộc gọi voice OTP qua FreeSWITCH, playback OTP digit, trả kết quả theo hangup cause.

### 2.2 Config jsonb

```json
{
  "host": "freeswitch.internal",
  "port": 8021,
  "password": "<eslpassword>",
  "originate_template": "originate {origination_caller_id_number=84812345678,absolute_codec_string=PCMA,playback_terminators=#}sofia/external/${dest}@gw1 &playback(/var/sounds/otp_${otp_digits}.wav)",
  "max_concurrent_calls": 50,
  "call_timeout_seconds": 30
}
```

Hoặc dialplan template với TTS:
```
originate {origination_uuid=${msg_id}}sofia/external/${dest}@gw1 &say(en number ${otp_digits})
```

### 2.3 Library

`link.thingscloud:freeswitch-esl-client:0.9.x` (Java ESL inbound client).

### 2.4 Connection pool

Mỗi channel có 1 ESL client persistent connection. `EslClientPool` quản:

```java
@Component
public class EslClientPool {
    private final Map<Long, EslClient> byChannelId = new ConcurrentHashMap<>();

    public EslClient get(Channel ch) {
        return byChannelId.computeIfAbsent(ch.id(), id -> connect(ch));
    }

    private EslClient connect(Channel ch) {
        Config cfg = parse(ch.config());
        EslClient c = new EslClient();
        c.connect(InetSocketAddress.createUnresolved(cfg.host(), cfg.port()), cfg.password(), 10);
        c.addEventListener(new ChannelHangupHandler(...));
        c.setEventSubscriptions("plain", "CHANNEL_HANGUP_COMPLETE CHANNEL_ANSWER");
        return c;
    }
}
```

Reconnect on disconnect: listener `OnEslDisconnect` → schedule reconnect 5s.

### 2.5 Flow

```java
@Override
public DispatchResult dispatch(Message msg, Channel ch) {
    Config cfg = parse(ch.config());
    EslClient client = pool.get(ch);

    String origStr = render(cfg.originateTemplate(), Map.of(
        "dest", msg.destAddr(),
        "otp_digits", extractOtp(msg.content()),
        "msg_id", msg.id().toString()
    ));

    // Track UUID để map event sau
    pendingCalls.put(msg.id(), new PendingCall(msg.id(), Instant.now()));

    EslMessage resp = client.sendApiCommand("bgapi", origStr);
    if (resp == null || !resp.getBodyLines().get(0).startsWith("+OK")) {
        pendingCalls.remove(msg.id());
        return new FailFinal("ESL_BGAPI_FAILED", resp != null ? resp.getBodyLines().get(0) : "no resp");
    }
    String jobUuid = resp.getBodyLines().get(0).substring(4).trim();

    // Submit thành công nghĩa là call được originate, kết quả qua event sau
    return new Success(jobUuid, latencyMs);
}
```

### 2.6 Event handler

```java
@Component
public class ChannelHangupHandler implements IEslEventListener {
    @Override
    public void eventReceived(EslEvent event) {
        if (!"CHANNEL_HANGUP_COMPLETE".equals(event.getEventName())) return;

        String msgId = event.getEventHeaders().get("variable_origination_uuid");
        if (msgId == null) return;

        String hangupCause = event.getEventHeaders().get("Hangup-Cause");
        DlrEvent dlr = new DlrEvent(
            UUID.fromString(msgId),
            mapHangupCauseToState(hangupCause),    // NORMAL_CLEARING → DELIVERED, NO_ANSWER/USER_BUSY → FAILED
            hangupCause,
            "FREESWITCH_ESL"
        );
        dlrIngress.handle(dlr);
    }
}

private String mapHangupCauseToState(String cause) {
    return switch (cause) {
        case "NORMAL_CLEARING", "NORMAL_DISCONNECT" -> "DELIVERED";
        case "NO_ANSWER", "USER_BUSY", "CALL_REJECTED" -> "FAILED";
        case "ORIGINATOR_CANCEL" -> "FAILED";
        default -> "FAILED";
    };
}
```

### 2.7 Concurrent call limit

`max_concurrent_calls`: semaphore per-channel:
```java
Semaphore sem = semaphores.computeIfAbsent(ch.id(), k -> new Semaphore(cfg.maxConcurrentCalls()));
if (!sem.tryAcquire(0, TimeUnit.SECONDS)) {
    return new FailRetryable("ESL_MAX_CONCURRENT", "too many calls");
}
try { /* dispatch */ } finally { sem.release(); }
```

### 2.8 TTS

Phase 1 dùng pre-recorded WAV (`/var/sounds/otp_<digits>.wav`) hoặc `say` application của FS với engine `flite` builtin.

TTS provider chốt sau (Polly, Google TTS, FPT.AI). Cập nhật ADR khi triển khai.

### 2.9 Phase 1 simplification

Phase 1 có thể không bind dispatcher này nếu chưa có FreeSWITCH instance. Skeleton class viết sẵn nhưng `@ConditionalOnProperty(name="app.dispatch.esl.enabled", havingValue="true")` để optional.

---

## 3. `TelcoSmppDispatcher`

### 3.1 Vai trò

Worker bind ra SMSC của telco/aggregator nguồn, submit_sm SMS thay cho partner.

### 3.2 Config jsonb

```json
{
  "host": "smsc.viettel.vn",
  "port": 2775,
  "system_id": "myaccount",
  "password": "<plaintext>",
  "system_type": "VMA",
  "bind_type": "TRANSCEIVER",
  "session_count": 2,
  "throughput_per_second": 100,
  "enquire_link_interval_ms": 30000,
  "source_addr_ton": 5,
  "source_addr_npi": 0,
  "dest_addr_ton": 1,
  "dest_addr_npi": 1,
  "registered_delivery": 1
}
```

### 3.3 Library

Cùng jSMPP, nhưng dùng `SMPPSession` (client) thay vì `SMPPServerSession`.

### 3.4 Session pool

```java
@Component
public class TelcoSmppSessionPool {
    private final Map<Long, List<TelcoSmppSession>> byChannel = new ConcurrentHashMap<>();
    private final ScheduledExecutorService reconnectExec;

    public TelcoSmppSession acquire(Channel ch) {
        List<TelcoSmppSession> list = byChannel.computeIfAbsent(ch.id(), k -> initSessions(ch));
        return roundRobin(list);   // load balance
    }

    private List<TelcoSmppSession> initSessions(Channel ch) {
        Config cfg = parse(ch.config());
        return IntStream.range(0, cfg.sessionCount())
            .mapToObj(i -> bind(ch, cfg, i))
            .toList();
    }

    private TelcoSmppSession bind(Channel ch, Config cfg, int idx) {
        SMPPSession s = new SMPPSession();
        s.connectAndBind(cfg.host(), cfg.port(),
            new BindParameter(BindType.of(cfg.bindType()),
                cfg.systemId(), cfg.password(), cfg.systemType(),
                TypeOfNumber.UNKNOWN, NumberingPlanIndicator.UNKNOWN, ""));
        s.setEnquireLinkTimer(cfg.enquireLinkIntervalMs());
        s.setMessageReceiverListener(new TelcoDeliverSmHandler(dlrIngress));   // nhận DLR
        s.addSessionStateListener((sess, newState, oldState) -> {
            if (newState.equals(SessionState.CLOSED)) reconnect(ch, idx);
        });
        return new TelcoSmppSession(ch.id(), idx, s);
    }
}
```

Reconnect: exponential backoff 5s, 10s, 30s, 60s (max).

### 3.5 Flow dispatch

```java
@Override
public DispatchResult dispatch(Message msg, Channel ch) {
    TelcoSmppSession session = pool.acquire(ch);
    if (session == null) return new FailRetryable("TELCO_NO_SESSION", "all sessions down");

    Config cfg = parse(ch.config());
    if (!throttler.tryAcquire("telco:throttle:" + ch.id(), cfg.throughputPerSecond())) {
        return new FailRetryable("TELCO_THROTTLED", "throughput exceeded");
    }

    try {
        byte[] body = encode(msg.content(), msg.encoding());
        String externalId = session.smpp().submitShortMessage(
            "",   // service_type
            cfg.sourceAddrTon(), cfg.sourceAddrNpi(), msg.sourceAddr(),
            cfg.destAddrTon(), cfg.destAddrNpi(), msg.destAddr(),
            new ESMClass(), (byte) 0, (byte) 1,
            null, null,                  // schedule_delivery_time, validity_period
            new RegisteredDelivery((byte) cfg.registeredDelivery()),
            (byte) 0,                    // replace_if_present_flag
            DataCoding.newInstance(dcsOf(msg.encoding())),
            (byte) 0, body
        );
        return new Success(externalId, latencyMs);
    } catch (PDUException | IOException | NegativeResponseException e) {
        if (e instanceof IOException) return new FailRetryable("TELCO_IO", e.getMessage());
        return new FailFinal("TELCO_REJECTED", e.getMessage());
    } catch (ResponseTimeoutException e) {
        return new FailRetryable("TELCO_TIMEOUT", e.getMessage());
    }
}
```

### 3.6 DLR handler trong session

```java
public class TelcoDeliverSmHandler implements MessageReceiverListener {
    @Override
    public void onAcceptDeliverSm(DeliverSm deliverSm) {
        if (MessageType.SMSC_DEL_RECEIPT.containedIn(deliverSm.getEsmClass())) {
            DeliveryReceipt dr = deliverSm.getShortMessageAsDeliveryReceipt();
            String telcoMsgId = dr.getId();   // map ngược về message qua message_id_telco
            String stateText = dr.getFinalStatus().toString();   // DELIVRD/EXPIRED/...
            dlrIngress.handle(new DlrEvent(telcoMsgId, mapTelcoState(stateText), dr));
        }
    }
}
```

### 3.7 Throughput per channel

`throughput_per_second` chia đều cho `session_count`. Throttle bằng Redis (xem `routing.md`).

### 3.8 Edge cases

- Session disconnect lúc submit: `IOException` → return `FailRetryable`. Worker requeue AMQP với delay 5s.
- SMSC trả `ESME_RTHROTTLED` (0x58): map về `FailRetryable` để retry sau.
- SMSC trả `ESME_RINVDSTADR` (0x0B): `FailFinal`.
- Session bind fail lúc startup: pool log lỗi, schedule reconnect.

---

## 4. So sánh tổng quát

| Aspect | HTTP_3rd | FREESWITCH_ESL | TELCO_SMPP |
|---|---|---|---|
| Connection model | Per-request | Persistent TCP | Persistent TCP, multi-session |
| Latency typical | 100-500ms | 1-10s (call duration) | 50-200ms |
| Auth | header/HMAC | ESL password | system_id+password SMPP |
| DLR ingress | webhook | event ESL | deliver_sm trong cùng session |
| Retry safe | yes (idempotent với client_ref) | NO | depend (telco có thể dedupe theo message_id) |
| Scale concern | timeout 3rd-party | concurrent calls | session count + throughput SMSC |

---

## 5. Common helpers

`worker/dispatch/CommonHelpers.java`:
- `render(String template, Map<String,String> vars)` — StringSubstitutor.
- `dcsOf(String encoding)` — GSM7→0, UCS2→8, LATIN1→3.
- `encode(String content, String encoding)` — return byte[].
- `mapHttpCodeToResult(int code)` — 2xx success, 4xx final, 5xx retryable.

---

## 6. Tests gợi ý

- HttpThirdPartyDispatcher: WireMock unit test (200 success, 503 retry, 400 final).
- TelcoSmppDispatcher: smppsim integration test.
- FreeSwitchEslDispatcher: hard to unit test, dùng manual e2e với FS local.

---

## 7. Phase 1 priority

1. `HttpThirdPartyDispatcher` (Phase 5) — đơn giản nhất, mock 3rd-party bằng httpbin.
2. `TelcoSmppDispatcher` (Phase 6) — quan trọng cho SMS thật.
3. `FreeSwitchEslDispatcher` (Phase 7) — cuối cùng, optional nếu chưa có FS infra.
