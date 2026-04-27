# Routing — RouteResolver, Cache, Fallback, Idempotency

Engine quyết định message inbound đi qua channel nào. Sống trong `worker/route/` package.

---

## 1. Input/Output

```
RouteResolver.resolve(partnerId, destAddr) → Optional<Route>

Route {
    Long channelId;
    Long fallbackChannelId;   // nullable
    Integer priority;
    String matchedPrefix;
}
```

Worker khi consume `sms.inbound`:
1. Gọi `resolve(partnerId, destAddr)`.
2. Nếu `Optional.empty()` → mark message FAILED, errorCode=`NO_ROUTE`, sinh DLR FAILED nội bộ.
3. Nếu có route → gọi `dispatcherRegistry.get(channel.type).dispatch(message, channel)`.

---

## 2. Thuật toán

### 2.1 Normalize `destAddr`

Đầu vào partner có thể là `+84901234567`, `84901234567`, `0901234567` → chuẩn hóa về **dạng E.164 không có '+'**: `84901234567`.

```java
public static String normalize(String dest) {
    String d = dest.trim().replaceAll("[\\s\\-]", "");
    if (d.startsWith("+")) d = d.substring(1);
    if (d.startsWith("00")) d = d.substring(2);
    if (d.startsWith("0")) d = "84" + d.substring(1);   // VN default
    return d;
}
```

Country code default `84` config qua `app.routing.default-cc`. Phase 1 hardcode VN.

### 2.2 Lookup

```java
public Optional<Route> resolve(long partnerId, String destAddr) {
    String dest = normalize(destAddr);
    List<RouteEntry> routes = routeCache.get(partnerId);  // sorted DESC by priority, then prefix length

    for (RouteEntry r : routes) {
        if (!r.enabled) continue;
        if (dest.startsWith(r.msisdnPrefix)) {
            return Optional.of(new Route(r.channelId, r.fallbackChannelId, r.priority, r.msisdnPrefix));
        }
    }
    return Optional.empty();
}
```

**Sort key**: `(priority DESC, length(prefix) DESC)`. Lý do:
- Priority cao trước → admin có thể override theo context.
- Cùng priority, prefix dài hơn match trước (longest-prefix-match) → routing chính xác.

Ví dụ:
| Route | priority | prefix | dest=`84901234567` |
|---|---|---|---|
| A | 100 | `84901` | match (length 5) |
| B | 100 | `849` | match (length 3, nhưng A đã match trước) |
| C | 200 | `84` | priority cao hơn → match trước cả A và B |

---

## 3. Cache trong Redis

### 3.1 Key & format

- Key: `route:<partner_id>`
- Type: Redis string chứa JSON array đã sort.
- TTL: 60s.

```json
[
  { "id": 12, "prefix": "84901", "channelId": 5, "fallbackChannelId": 6, "priority": 100, "enabled": true },
  { "id": 13, "prefix": "849",   "channelId": 7, "fallbackChannelId": null, "priority": 100, "enabled": true }
]
```

### 3.2 Load on miss

```java
@Component
public class RouteCache {
    private final RedisTemplate<String, String> redis;
    private final RouteRepository repo;
    private final ObjectMapper json;

    public List<RouteEntry> get(long partnerId) {
        String key = "route:" + partnerId;
        String cached = redis.opsForValue().get(key);
        if (cached != null) return parse(cached);

        List<RouteEntry> fresh = repo.findActiveByPartner(partnerId).stream()
            .sorted(comparingInt(RouteEntry::priority).reversed()
                .thenComparing(comparingInt((RouteEntry r) -> r.prefix.length()).reversed()))
            .toList();
        redis.opsForValue().set(key, json.writeValueAsString(fresh), Duration.ofSeconds(60));
        return fresh;
    }
}
```

### 3.3 Cache invalidation

Admin tạo/sửa/xóa route qua API → controller publish event sang Redis pub/sub:

```
Channel: route.invalidate
Message: <partner_id>
```

Worker có listener:
```java
@Component
public class RouteInvalidationListener implements MessageListener {
    @Override
    public void onMessage(Message msg, byte[] pattern) {
        long partnerId = Long.parseLong(new String(msg.getBody()));
        redis.delete("route:" + partnerId);
    }
}
```

Subscribe trong `RedisConfig`:
```java
@Bean
RedisMessageListenerContainer container(RedisConnectionFactory cf, RouteInvalidationListener l) {
    RedisMessageListenerContainer c = new RedisMessageListenerContainer();
    c.setConnectionFactory(cf);
    c.addMessageListener(l, new ChannelTopic("route.invalidate"));
    return c;
}
```

Lý do dùng pub/sub thay vì TTL ngắn:
- TTL 60s nghĩa là update route mất tới 60s mới applied trên mọi worker → quá chậm cho admin UI.
- Pub/sub: admin update → mọi worker invalidate ngay (eventual consistency vài chục ms).

---

## 4. Fallback channel

Nếu primary channel `dispatch()` trả `FAIL_RETRYABLE` hoặc throw exception:

```java
DispatchResult primary = dispatcher.dispatch(msg, channel);

if (primary.isFailure() && route.fallbackChannelId() != null) {
    Channel fb = channelRepo.findById(route.fallbackChannelId()).orElseThrow();
    DispatchResult fbResult = dispatcherRegistry.get(fb.type()).dispatch(msg, fb);
    if (fbResult.isSuccess()) {
        msg.setChannelId(fb.id());
        msg.setState("SUBMITTED");
    } else {
        msg.setState("FAILED");
        msg.setErrorCode(fbResult.errorCode());
    }
} else if (primary.isSuccess()) {
    msg.setChannelId(channel.id());
    msg.setState("SUBMITTED");
} else {
    msg.setState("FAILED");
    msg.setErrorCode(primary.errorCode());
}
```

**Fallback chỉ thử 1 lần**. Nếu fallback cũng fail → FAILED. Không gọi đệ quy hoặc fallback chained (giữ logic đơn giản phase 1).

---

## 5. Retry policy per channel type

| Channel type | Retry count | Backoff | Note |
|---|---|---|---|
| `HTTP_THIRD_PARTY` | 3 | 1s, 3s, 9s | Chỉ retry với 5xx hoặc timeout. 4xx KHÔNG retry. |
| `TELCO_SMPP` | 0 (submit_sm) | — | Telco quản lý retry. Nếu session disconnect lúc submit → requeue AMQP với 5s delay. |
| `FREESWITCH_ESL` | 0 | — | Voice OTP user-facing, retry sẽ confuse (call lại ngay sau khi cúp máy). |

Implementation retry trong `HttpThirdPartyDispatcher` (xem `dispatchers.md`).

Requeue AMQP khi `TELCO_SMPP` lost session: worker republish message vào exchange `sms.inbound.delay` (x-delayed-message exchange) với header `x-delay: 5000`. Sau 5s message rơi lại vào `sms.inbound.q`.

---

## 6. Idempotency

Message AMQP có thể được redeliver (RabbitMQ at-least-once). Worker phải tránh dispatch 2 lần cùng 1 message ra channel ngoài.

### 6.1 Cơ chế

Trước khi dispatch, lock theo `message_id`:

```java
Boolean acquired = redis.opsForValue().setIfAbsent(
    "msg:dispatch:" + msg.getId(),
    workerInstanceId(),
    Duration.ofSeconds(300)
);
if (Boolean.FALSE.equals(acquired)) {
    log.warn("message {} already being dispatched by another worker, skip", msg.getId());
    return;   // ack message (consume mà không làm gì)
}
try {
    // dispatch
} finally {
    redis.delete("msg:dispatch:" + msg.getId());
}
```

### 6.2 Edge case

- Worker A acquire lock, dispatch xong, set state=SUBMITTED, release lock.
- Message redeliver tới worker B → B acquire lock, kiểm tra state=SUBMITTED → skip.

Code:
```java
if (msg.getState() != "RECEIVED" && msg.getState() != "ROUTED") {
    log.info("message {} already in state {}, skip", msg.getId(), msg.getState());
    return;
}
```

### 6.3 Tại sao không lock DB row

DB row lock (SELECT FOR UPDATE) blocks transaction → hạn chế throughput. Redis lock nhẹ hơn 10x.

---

## 7. State transitions trong worker

```
RECEIVED ──RouteResolver match──► ROUTED ──Dispatcher.dispatch──► SUBMITTED
   │                                 │                              │
   │ no route                        │ all dispatch fail            │ DLR comes
   ▼                                 ▼                              ▼
 FAILED                            FAILED                       DELIVERED / FAILED
```

Worker update state qua JPA `Optimistic Lock` (`@Version`). Concurrent update → exception → retry tối đa 3 lần.

---

## 8. Throughput considerations

- Default consumer concurrency: `concurrency = "4-16"` trên `@RabbitListener`.
- Mỗi consumer thread: 1 RouteResolver call (Redis), 1 dispatch (HTTP/SMPP/ESL), 1 DB update.
- Bottleneck thường là dispatch (network I/O ngoài). Java 21 virtual thread giúp scale concurrency lên 1000+.

`application.yml`:
```yaml
spring:
  rabbitmq:
    listener:
      simple:
        concurrency: ${RABBIT_CONSUMER_MIN:4}
        max-concurrency: ${RABBIT_CONSUMER_MAX:32}
        prefetch: ${RABBIT_PREFETCH:32}
```

---

## 9. Monitoring (phase 1: log only)

Log mỗi resolve:
```
INFO  [route partner=12 dest=84901234567] resolved channel=5 prefix=8490 priority=100 fallback=6
WARN  [route partner=12 dest=99000000000] no route found
```

Log mỗi dispatch:
```
INFO  [dispatch msg=01HZ... channel=5 type=HTTP_THIRD_PARTY] success in 245ms
WARN  [dispatch msg=01HZ... channel=5 type=HTTP_THIRD_PARTY] failed: 503, fallback to channel=6
ERROR [dispatch msg=01HZ... channel=6 type=TELCO_SMPP] all attempts failed: bind disconnected
```

Phase 2+ thêm Prometheus counter `routing_resolved_total{partner,channel,outcome}` và histogram `dispatch_latency_seconds`.

---

## 10. Edge cases

### 10.1 Partner không có route nào

`resolve()` trả empty → message FAILED với `errorCode=NO_ROUTE`. Sinh DLR nội bộ:
```json
{ "messageId": "...", "state": "FAILED", "errorCode": "NO_ROUTE", "source": "INTERNAL" }
```

Forward về partner như DLR bình thường (ADR-007).

### 10.2 Dest có ký tự không phải số

Reject ngay tầng API (validation 400) hoặc tầng SMPP (`STAT_ESME_RINVDSTADR`). Không vào RouteResolver.

### 10.3 Channel disabled lúc dispatch

Trước khi gọi dispatcher, recheck:
```java
Channel ch = channelRepo.findById(route.channelId()).orElseThrow();
if (!"ACTIVE".equals(ch.status())) {
    // try fallback
}
```

### 10.4 Route enabled=false nhưng còn trong cache

Cache miss/invalidation chỉ trigger khi update qua admin API. Nếu admin update DB trực tiếp (bypass API) → cache không invalidate. **Quy ước**: cấm sửa DB trực tiếp, mọi thay đổi master data qua API.

Phase tương lai có thể thêm Postgres LISTEN/NOTIFY trigger để auto-invalidate.
