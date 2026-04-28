# TASK: Worker — Luồng 3, 4, 5

> **Resume file** — đọc file này đầu session mới, sau đó đọc các file ngữ cảnh bên dưới rồi bắt đầu code ngay.
> Không cần đọc lại toàn bộ smpp-plan.md hay docs — mọi thứ cần thiết đã tóm gọn ở đây.

---

## Trạng thái hiện tại (`2026-04-28`)

Build: `./mvnw -B clean package -DskipTests` — 4 modules (`core`, `smpp-server`, `worker`, parent) **SUCCESS**. Commit cuối: `8109fd4`.

**Đã xong:**
- T06–T26 (Phase 2–4): DB schema, JPA entities, admin/portal API, SMPP listener, partner HTTP API, DLR ingress/forwarder
- Luồng 1: `SmsDispatcherService` + callers SpeedSMS / eSMS / Vietguys / Abenla / Infobip / CUSTOM
- Luồng 2: `TelcoSmppSessionPool` + `TelcoSmppDispatcher` + `TelcoDlrProcessor` (outbound SMPP → telco SMSC)

**Chưa xong (task này):**
- Luồng 3: FreeSWITCH ESL dispatcher (voice OTP nội bộ)
- Luồng 4: Rate billing trong worker (deduct partner balance)
- Luồng 5: Route cache Redis (performance, optional)

---

## Files ngữ cảnh — đọc theo thứ tự này khi start session

### Bắt buộc đọc

| File | Lý do |
|------|-------|
| `smpp/backend/worker/src/main/java/com/smpp/worker/InboundMessageConsumer.java` | Entry point xử lý message — nơi wire Luồng 3, 4 |
| `smpp/backend/worker/src/main/java/com/smpp/worker/VoiceOtpDispatcherService.java` | Template cho Luồng 3 (pattern giống TwoMobileVoiceCaller) |
| `smpp/backend/worker/src/main/java/com/smpp/worker/telco/TelcoSmppSessionPool.java` | Template cho EslSessionPool (session pool + reconnect pattern) |
| `smpp/backend/worker/src/main/java/com/smpp/worker/telco/TelcoDlrProcessor.java` | Template cho Luồng 4 (transaction pattern + AMQP publish) |
| `smpp/backend/core/src/main/java/com/smpp/core/service/RateResolver.java` | Đã implement, dùng cho Luồng 4 |
| `smpp/backend/core/src/main/java/com/smpp/core/domain/Partner.java` | Xem field `balance` và `@Version version` cho Luồng 4 |
| `smpp/backend/worker/src/main/java/com/smpp/worker/RouteResolver.java` | Xem cách dùng CarrierResolver — cần cho Luồng 4 (lấy carrier) |

### Đọc thêm nếu cần

| File | Lý do |
|------|-------|
| `smpp/backend/worker/pom.xml` | Kiểm tra `freeswitch-esl-client` dependency (Luồng 3) |
| `smpp/backend/smpp-server/src/main/java/com/smpp/server/http/admin/channel/ChannelHandlers.java` | Config validation: ESL_REQUIRED = `{host, port, password}` |
| `smpp/backend/worker/src/main/java/com/smpp/worker/CarrierResolver.java` | resolve(destAddr) → Optional<String> carrier (Luồng 4) |
| `smpp/backend/smpp-server/src/main/java/com/smpp/server/http/admin/route/RouteHandlers.java` | Nơi thêm cache invalidation cho Luồng 5 |

---

## Luồng 3 — FreeSWITCH ESL Dispatcher

### Mục tiêu
`VoiceOtpDispatcherService` hiện chỉ có case `"2TMOBILE_VOICE"`. Cần thêm case `"FREESWITCH_ESL"`.

### Channel config (FREESWITCH_ESL, type = FREESWITCH_ESL, delivery_type = VOICE_OTP)
```json
{
  "provider_code": "FREESWITCH_ESL",
  "host": "192.168.1.10",
  "port": 8021,
  "password": "ClueCon",
  "gateway": "viettel-gw",
  "wav_file": "otp.wav",
  "caller_id_name": "OTP",
  "caller_id_number": "19001234",
  "timeout_ms": 30000
}
```

### Library
`link.thingscloud:freeswitch-esl-client:0.9.2` — đã có trong `dependencyManagement` của parent pom. Chỉ cần thêm vào `worker/pom.xml`:
```xml
<dependency>
    <groupId>link.thingscloud</groupId>
    <artifactId>freeswitch-esl-client</artifactId>
</dependency>
```

### Files cần tạo

```
worker/src/main/java/com/smpp/worker/esl/
  EslConnectionPool.java       -- @Component; 1 kết nối ESL per FREESWITCH_ESL channel; @ApplicationReadyEvent init; auto-reconnect
  FreeSwitchEslDispatcher.java -- @Component; gọi `api originate`; subscribe CHANNEL_HANGUP_COMPLETE; map hangup cause → DispatchResult
```

### EslConnectionPool design

```java
// Library: link.thingscloud.freeswitch.esl.InboundClientService
// Hoặc: link.thingscloud.freeswitch.esl.transport.option.ConnectOptions

// Kết nối ESL:
ConnectOptions options = ConnectOptions.newBuilder()
    .serverAddress(host)
    .serverPort(port)
    .password(password)
    .build();
InboundClientService client = InboundClientService.newInstance(options);
client.addEventListener(listener);  // IEslEventListener
client.connect();
// client.sendApiCommand("api", "originate {...}");
```

### FreeSwitchEslDispatcher design

```java
// Originate lệnh:
String cmd = String.format(
    "{origination_caller_id_name='%s',origination_caller_id_number='%s'}sofia/gateway/%s/%s &playback(%s)",
    callerIdName, callerIdNumber, gateway, destAddr, wavFile);
EslMessage response = client.sendApiCommand("api", "originate " + cmd);
// response.getBodyLines() → ["+OK <uuid>"] hoặc ["-ERR <reason>"]

// Parse:
String line = response.getBodyLines().get(0);
boolean ok = line.startsWith("+OK");
String uuid = ok ? line.substring(4).trim() : null;
```

### DLR via CHANNEL_HANGUP_COMPLETE

```java
// Register event listener:
client.setEventSubscriptions(EventType.CUSTOM, ...);
// Hoặc: client.sendApiCommand("events", "plain CHANNEL_HANGUP_COMPLETE");

// Event handler:
@Override
public void eventReceived(EslEvent event) {
    if ("CHANNEL_HANGUP_COMPLETE".equals(event.getEventName())) {
        String hangupUuid = event.getEventHeaders().get("Unique-ID");
        String hangupCause = event.getEventHeaders().get("Hangup-Cause");
        // NORMAL_CLEARING → DELIVERED; others → FAILED
        // Correlate hangupUuid với UUID từ originate response
    }
}
```

### Correlation UUID → messageId

Cần lưu mapping `uuid → (messageId, channelId)` trong memory (`ConcurrentHashMap`) khi originate xong, remove khi nhận CHANNEL_HANGUP_COMPLETE. TTL nên là `timeout_ms + buffer` để tránh memory leak.

### Wire vào VoiceOtpDispatcherService

```java
// Thêm field:
private final FreeSwitchEslDispatcher eslDispatcher;

// Thêm case trong dispatch():
case "FREESWITCH_ESL" -> eslDispatcher.dispatch(config, destAddr, content);
```

### VoiceOtpDispatcherService.DispatchResult

Khi CHANNEL_HANGUP_COMPLETE nhận được, gọi `messageRepo.updateState(...)` trực tiếp trong listener (qua `TelcoDlrProcessor` pattern). ESL DLR không đi qua AMQP vì voice OTP không có partner DLR callback.

> **Lưu ý quan trọng**: FreeSWITCH ESL originate là blocking (wait for answer) hoặc async. Nên dùng async: originate → return `(true, uuid, null)` ngay → cập nhật state về SUBMITTED. Khi hangup event đến → update sang DELIVERED/FAILED. Điều này giống TELCO_SMPP pattern hơn.

---

## Luồng 4 — Rate Billing trong Worker

### Mục tiêu
Sau khi dispatch thành công → deduct `partner.balance` theo rate đã tính.

### RateResolver đã sẵn sàng
```java
// Đã có trong core/src/main/java/com/smpp/core/service/RateResolver.java:
Optional<PartnerRate> resolvePartnerRate(Long partnerId, DeliveryType deliveryType, String carrier, String msisdnPrefix)
```

### Partner entity
```java
// core/src/main/java/com/smpp/core/domain/Partner.java
@Column(nullable = false, precision = 15, scale = 4)
private BigDecimal balance = BigDecimal.ZERO;

@Version
@Column(nullable = false)
private int version;  // optimistic locking
```

### Files cần tạo

```
core/src/main/java/com/smpp/core/service/PartnerBalanceService.java
```

```java
@Service
public class PartnerBalanceService {

    private static final int MAX_RETRIES = 3;

    // Deduct unitPrice from partner balance. No-op if rate not found.
    @Transactional
    public void deductForMessage(UUID messageId, Long partnerId, DeliveryType deliveryType,
                                  String carrier, String msisdnPrefix) {
        Optional<PartnerRate> rateOpt = rateResolver.resolvePartnerRate(
                partnerId, deliveryType, carrier, msisdnPrefix);
        if (rateOpt.isEmpty()) {
            log.warn("No partner rate: partnerId={} type={} carrier={} prefix={}", ...);
            return;  // no charge — admin alert handled separately
        }
        BigDecimal amount = rateOpt.get().getUnitPrice();

        // Retry loop for OptimisticLockException
        for (int i = 0; i < MAX_RETRIES; i++) {
            try {
                partnerRepo.deductBalance(partnerId, amount);  // see PartnerRepository below
                return;
            } catch (ObjectOptimisticLockingFailureException e) {
                if (i == MAX_RETRIES - 1) throw e;
            }
        }
    }
}
```

### PartnerRepository — thêm method

```java
// Trong core/src/main/java/com/smpp/core/repository/PartnerRepository.java
@Modifying
@Transactional
@Query("UPDATE Partner p SET p.balance = p.balance - :amount WHERE p.id = :id AND p.balance >= :amount")
int deductBalance(@Param("id") Long id, @Param("amount") BigDecimal amount);
// Trả về 0 nếu balance không đủ (không deduct).
```

### Wire vào InboundMessageConsumer

```java
// Sau khi dispatch thành công (result.success() == true):
// Lấy carrier từ CarrierResolver (đã inject vào RouteResolver, cần expose hoặc inject riêng)
// Hoặc lưu carrier trong route resolution step

// Cách đơn giản: inject CarrierResolver vào InboundMessageConsumer
Optional<String> carrier = carrierResolver.resolve(event.destAddr());
partnerBalanceService.deductForMessage(
    event.messageId(), event.partnerId(),
    channel.getDeliveryType(), carrier.orElse(null), event.destAddr());
```

> **Lưu ý**: Không throw nếu balance không đủ — chỉ log warning. Cơ chế pre-paid đầy đủ (reject nếu balance < 0) thuộc Phase 5+.

### DoD
- Dispatch VOICE_OTP → balance giảm theo PartnerRate
- Dispatch SMS → balance giảm
- Không có rate → log warn, không deduct, message vẫn SUBMITTED
- Concurrent dispatch → không bị double-deduct (optimistic lock + retry)

---

## Luồng 5 — Route Cache Redis (Optional)

### Mục tiêu
`RouteResolver.resolve()` hiện query DB mỗi message. Cache kết quả trong Redis TTL 60s.

### Cache key
```
route:partner:<partnerId>:<destAddr>
```

### Cache value
Serialize `Channel` tối giản (không phải full entity):
```java
record ChannelRef(Long id, String code, ChannelType type, DeliveryType deliveryType, String configJson) {}
```

Serialize với Jackson → JSON string → lưu vào Redis `StringRedisTemplate`.

### Flow

```java
// RouteResolver.resolve():
String cacheKey = "route:partner:" + partnerId + ":" + destAddr;
String cached = redisTemplate.opsForValue().get(cacheKey);
if (cached != null) {
    return deserializeChannelRef(cached);  // hydrate Channel từ ChannelRef
}
// ... existing DB lookup ...
if (channel present) {
    redisTemplate.opsForValue().set(cacheKey, serialize(channel), 60, TimeUnit.SECONDS);
}
return result;
```

### Cache invalidation

Thêm vào `RouteHandlers` (smpp-server) sau `routeRepo.save()` và `routeRepo.delete()`:
```java
// Invalidate tất cả cache entries của partner này:
redisTemplate.delete(redisTemplate.keys("route:partner:" + partnerId + ":*"));
```

> **Lưu ý**: `keys()` với pattern là O(N) — chỉ dùng được nếu số lượng key nhỏ. Thay bằng `scan()` nếu Redis lớn. Hoặc chỉ invalidate 1 key cụ thể nếu admin cung cấp destAddr.

### Dependency thêm
Worker cần inject `StringRedisTemplate` hoặc `RedisTemplate<String, String>`. Spring Data Redis đã có trong core — chỉ inject thêm bean.

### DoD
- Route resolve lần 2 cùng partner+dest → không query DB (log CACHE_HIT)
- Admin update route → cache bị xóa → resolve lần tiếp theo query DB lại

---

## Thứ tự implement

```
Luồng 4 (dễ nhất, không có dependency mới)
  → Luồng 3 (cần freeswitch-esl-client, phức tạp hơn)
  → Luồng 5 (optional, chỉ làm nếu cần)
```

---

## Build + Verify commands

```bash
# Working directory: smpp/backend/

# Build
JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot" ./mvnw -B clean package -DskipTests

# Infra containers (phải đang chạy)
docker ps --filter "name=smpp-postgres|smpp-redis|smpp-rabbitmq"
# Nếu stopped:
docker start smpp-postgres smpp-redis smpp-rabbitmq

# Smoke test admin auth
TOKEN=$(curl -s -X POST http://localhost:8080/api/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@123456"}' | jq -r .token)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/admin/auth/me
```

---

## Key decisions đã chốt (không thay đổi)

- Spring Boot chỉ DI/lifecycle — HTTP = Vert.x Web, KHÔNG Spring MVC
- Worker = pure AMQP consumer, không có HTTP server
- Encoding code: tiếng Anh; docs: tiếng Việt
- jSMPP 3.0.0: `submitShortMessage()` trả về `SubmitSmResult` (không phải `String`) — gọi `.getMessageId()`
- jSMPP 3.0.0: `deliverSm.getEsmClass()` trả về `byte` — dùng `MessageType.SMSC_DEL_RECEIPT.containedIn(byte)` để check
- TELCO_SMPP DLR: không đi qua `/api/internal/dlr` HTTP — xử lý trực tiếp trong worker qua AMQP
