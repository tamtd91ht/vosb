# Backend — Spring Boot 3 + jSMPP

Backend là Gradle multi-module repo gồm 3 module: `core`, `smpp-server`, `worker`.

---

## 1. Gradle multi-module layout

```
smpp/backend/
├── settings.gradle.kts                # rootProject + include 3 modules
├── build.gradle.kts                   # common config: java 21, repositories
├── gradle/
│   └── libs.versions.toml             # version catalog (jsmpp, esl, spring-boot, ...)
├── core/                              # plain library jar, KHÔNG có @SpringBootApplication
│   ├── build.gradle.kts
│   └── src/main/
│       ├── java/vn/vihat/smpp/core/
│       │   ├── domain/                # @Entity Partner, Channel, Route, Message, Dlr, ...
│       │   ├── repository/            # Spring Data JPA interface
│       │   ├── dto/                   # DTO chia sẻ giữa smpp-server và worker
│       │   ├── messaging/             # Exchanges, Queues, RoutingKeys constants
│       │   ├── security/              # PasswordHasher, HmacSigner
│       │   └── config/                # @Configuration cho DataSource, Redis, AMQP (auto-import)
│       └── resources/
│           └── db/migration/          # Flyway V1__init.sql, V2__..., V3__...
├── smpp-server/                       # Spring Boot app, có @SpringBootApplication
│   ├── build.gradle.kts               # implementation(project(":core"))
│   ├── Dockerfile                     # multi-stage Java 21
│   └── src/main/
│       ├── java/vn/vihat/smpp/server/
│       │   ├── ServerApplication.java
│       │   ├── smpp/                  # jSMPP listener
│       │   ├── api/{partner,admin,portal}/
│       │   ├── auth/                  # 3 SecurityFilterChain (partner, admin, portal)
│       │   ├── inbound/               # MessagePublisher (publish sms.inbound)
│       │   └── outbound/              # DlrForwarder (consume sms.dlr)
│       └── resources/
│           ├── application.yml
│           └── application-prod.yml
├── worker/                            # Spring Boot app, web=none
│   ├── build.gradle.kts
│   ├── Dockerfile
│   └── src/main/
│       ├── java/vn/vihat/smpp/worker/
│       │   ├── WorkerApplication.java
│       │   ├── inbound/               # SmsInboundConsumer
│       │   ├── route/                 # RouteResolver, RouteCache
│       │   ├── dispatch/              # ChannelDispatcher (interface + 3 impls)
│       │   ├── client/                # SMPP/ESL/HTTP clients + connection pools
│       │   └── dlr/                   # DlrIngressHandler
│       └── resources/
│           └── application.yml
└── docker-compose.yml                 # deploy stack (sẽ deploy về ~/apps/smpp-app/)
```

**Lý do tách `core`**:
- Domain entity + JPA repository dùng cùng schema → không duplicate.
- DTO chia sẻ qua AMQP message → 2 service deserialize cùng class.
- Config DataSource/Redis/AMQP common → smpp-server và worker import.
- KHÔNG có Spring Boot main class trong `core` (tránh ambiguous).

---

## 2. `core/` chi tiết

### 2.1 Package layout

| Package | Vai trò |
|---|---|
| `domain` | `@Entity` JPA classes mapping bảng SQL |
| `repository` | `interface XxxRepository extends JpaRepository<...>` |
| `dto` | Record/POJO dùng cho REST + AMQP (vd `InboundMessageEvent`, `DlrEvent`) |
| `messaging` | Constants `Exchanges.SMS_INBOUND="sms.inbound"`, `Queues.SMS_INBOUND_Q="sms.inbound.q"`, `RoutingKeys.partner(id)` |
| `security` | `PasswordHasher` (bcrypt wrapper), `HmacSigner.verify(...)` |
| `config` | `@Configuration` classes auto-imported qua Spring Boot auto-config (đặt `META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports`) |

### 2.2 RabbitMQ topology constants

```java
public final class Exchanges {
    public static final String SMS_INBOUND = "sms.inbound";  // topic
    public static final String SMS_DLR     = "sms.dlr";       // topic
    public static final String DLR_RETRY   = "sms.dlr.retry"; // delayed (x-delayed-message)
    private Exchanges() {}
}

public final class Queues {
    public static final String SMS_INBOUND_Q = "sms.inbound.q";
    public static final String SMS_DLR_Q     = "sms.dlr.q";
    public static final String DLR_RETRY_Q   = "sms.dlr.retry.q";
    private Queues() {}
}

public final class RoutingKeys {
    public static String partner(long id) { return "partner." + id; }
    public static String channel(long id) { return "channel." + id; }
}
```

Binding:
- `sms.inbound` (topic) → `sms.inbound.q` với pattern `partner.*`.
- `sms.dlr` (topic) → `sms.dlr.q` với pattern `partner.*`.
- `sms.dlr.retry` (x-delayed-message) → `sms.dlr.retry.q` (chỉ worker consume).

### 2.3 Flyway migration policy

- File đặt tại `core/src/main/resources/db/migration/`.
- Naming: `V<n>__<description>.sql` (vd `V1__init.sql`, `V2__add_dlr_webhook_url.sql`).
- KHÔNG sửa migration đã apply (Flyway sẽ fail checksum).
- Production migrate tự động khi `smpp-server` start (worker tắt flyway: `spring.flyway.enabled=false` để tránh race).

---

## 3. `smpp-server/` chi tiết

### 3.1 Vai trò

- TCP SMPP listener (port 2775) — accept bind từ partner.
- HTTP server (port 8080) — 3 nhóm endpoint: partner, admin, portal.
- Publish AMQP `sms.inbound` cho mỗi message inbound.
- Consume AMQP `sms.dlr` để forward DLR về partner.

### 3.2 SMPP listener

`smpp/SmppServerConfig.java` — bootstrap jSMPP:

```java
@Configuration
public class SmppServerConfig {
    @Bean(destroyMethod = "close")
    public SMPPServerSessionListener smppListener(...) throws IOException {
        SMPPServerSessionListener l = new SMPPServerSessionListener(2775);
        // accept loop chạy ở thread pool riêng
    }
}
```

`smpp/MessageReceiverListenerImpl.java` implement:
- `onAcceptBind(BindRequest req, ServerResponseSender sender)` → `BindAuthenticator.authenticate(systemId, password, sourceIp)`. Nếu fail → `sender.sendNegativeResponse(SMPPConstant.STAT_ESME_RBINDFAIL)`.
- `onAcceptSubmitSm(SubmitSm sm, SMPPServerSession session)` → tạo `Message` entity, save DB (state=RECEIVED), publish AMQP, trả message_id.
- `onAcceptUnbind(...)` → `SessionRegistry.remove(session)`.

`smpp/SessionRegistry.java` — quản lý Map<systemId, List<SMPPServerSession>> trong memory + sync với Redis hash `smpp:session:<system_id>` (count). Hỗ trợ admin "kick" qua `/api/admin/sessions/{system_id}/kick`.

Chi tiết đầy đủ: `smpp-protocol.md`.

### 3.3 HTTP API — 3 SecurityFilterChain riêng

Spring Security 6 cho phép nhiều `SecurityFilterChain` với `@Order` khác nhau, match path khác nhau:

```java
@Configuration
public class SecurityConfig {

    @Bean
    @Order(1)
    SecurityFilterChain partnerApi(HttpSecurity http) {
        http.securityMatcher("/api/v1/**")
            .addFilterBefore(new ApiKeyHmacFilter(...), UsernamePasswordAuthenticationFilter.class)
            .csrf(c -> c.disable())
            .sessionManagement(s -> s.sessionCreationPolicy(STATELESS));
        return http.build();
    }

    @Bean
    @Order(2)
    SecurityFilterChain adminApi(HttpSecurity http) {
        http.securityMatcher("/api/admin/**")
            .addFilterBefore(new JwtAuthFilter(...), UsernamePasswordAuthenticationFilter.class)
            .authorizeHttpRequests(a -> a
                .requestMatchers("/api/admin/auth/login").permitAll()
                .anyRequest().hasRole("ADMIN"));
        return http.build();
    }

    @Bean
    @Order(3)
    SecurityFilterChain portalApi(HttpSecurity http) { /* role PARTNER */ }
}
```

Endpoint chi tiết → `api.md`.

### 3.4 DLR forwarder

`outbound/DlrForwarder.java` — `@RabbitListener(queues = SMS_DLR_Q)`:
1. Đọc `DlrEvent { messageId, partnerId, state, errorCode }`.
2. Query active SMPP session của partner trong `SessionRegistry`.
3. Nếu có → gọi `session.deliverShortMessage(...)` (deliver_sm DLR PDU).
4. Nếu không có session active → check `partner.dlr_webhook_url` → POST JSON.
5. Webhook fail → publish `sms.dlr.retry` (delayed 30s/2m/10m).

### 3.5 Healthcheck + actuator

`application.yml`:
```yaml
management:
  endpoints:
    web:
      exposure:
        include: health,info
  endpoint:
    health:
      group:
        liveness: { include: livenessState, ping }
        readiness: { include: readinessState, db, redis, rabbit }
      probes:
        enabled: true
```

Nginx **chặn** mọi request `/actuator/*` (return 404). Healthcheck Docker dùng nội bộ `127.0.0.1:8080`.

---

## 4. `worker/` chi tiết

### 4.1 Vai trò

- Consume `sms.inbound` → route → dispatch.
- Manage outbound clients (HTTP, ESL, SMPP client).
- Ingress DLR từ telco (qua SMPP client session) và FreeSWITCH event.
- Publish `sms.dlr` để smpp-server forward về partner.

### 4.2 Bootstrap

`WorkerApplication.java`:
```java
@SpringBootApplication
public class WorkerApplication {
    public static void main(String[] args) {
        new SpringApplicationBuilder(WorkerApplication.class)
            .web(WebApplicationType.NONE)   // không expose HTTP
            .run(args);
    }
}
```

`application.yml`:
```yaml
spring:
  flyway:
    enabled: false              # smpp-server đã migrate
  main:
    web-application-type: none
```

### 4.3 Inbound consumer

`inbound/SmsInboundConsumer.java`:
```java
@Component
public class SmsInboundConsumer {
    @RabbitListener(queues = SMS_INBOUND_Q, concurrency = "4-16")
    public void onMessage(InboundMessageEvent evt) {
        // 1. Idempotency check Redis SETNX msg:<id> 1 EX 86400
        // 2. RouteResolver.resolve(evt.partnerId, evt.destAddr) -> Route
        // 3. ChannelDispatcher.dispatch(message, route.channel)
        //    nếu fail -> dispatch fallbackChannel
        // 4. Update message state DB
    }
}
```

### 4.4 ChannelDispatcher — Strategy pattern

```java
public interface ChannelDispatcher {
    ChannelType supportedType();
    DispatchResult dispatch(Message msg, Channel channel);
}

@Component class HttpThirdPartyDispatcher implements ChannelDispatcher { ... }
@Component class FreeSwitchEslDispatcher implements ChannelDispatcher { ... }
@Component class TelcoSmppDispatcher implements ChannelDispatcher { ... }
```

Wire:
```java
@Service
public class DispatcherRegistry {
    private final Map<ChannelType, ChannelDispatcher> map;
    public DispatcherRegistry(List<ChannelDispatcher> all) {
        this.map = all.stream().collect(toMap(ChannelDispatcher::supportedType, identity()));
    }
    public ChannelDispatcher get(ChannelType t) { return map.get(t); }
}
```

Chi tiết 3 dispatcher → `dispatchers.md`.

### 4.5 DLR ingress

`dlr/DlrIngressHandler.java` — entry point chung, được gọi từ:
- `TelcoSmppDispatcher` khi nhận `deliver_sm` DLR.
- `FreeSwitchEslDispatcher` khi nhận `CHANNEL_HANGUP_COMPLETE` event.
- 3rd-party webhook: Worker bootstrap thêm 1 endpoint nội bộ tạm hoặc đặt endpoint webhook trong smpp-server và route qua AMQP `sms.dlr.ingress`. Mặc định: **đặt webhook trong smpp-server** để worker không cần web tier (ADR ngầm: theo phase đầu).

Handler:
1. Lookup `message` theo `message_id_telco` (cache Redis 1h).
2. Insert row `dlr` với raw_payload jsonb.
3. Update `message.state` (DELIVERED/FAILED).
4. Publish `sms.dlr` event.

Chi tiết đầy đủ → `dlr-flow.md`.

---

## 5. Dependencies chính

`gradle/libs.versions.toml`:

```toml
[versions]
java = "21"
spring-boot = "3.3.0"
jsmpp = "3.0.0"
esl-client = "0.9.2"
flyway = "10.14.0"
postgresql = "42.7.3"

[libraries]
spring-boot-starter            = { module = "org.springframework.boot:spring-boot-starter", version.ref = "spring-boot" }
spring-boot-starter-web        = { module = "org.springframework.boot:spring-boot-starter-web", version.ref = "spring-boot" }
spring-boot-starter-data-jpa   = { module = "org.springframework.boot:spring-boot-starter-data-jpa", version.ref = "spring-boot" }
spring-boot-starter-amqp       = { module = "org.springframework.boot:spring-boot-starter-amqp", version.ref = "spring-boot" }
spring-boot-starter-data-redis = { module = "org.springframework.boot:spring-boot-starter-data-redis", version.ref = "spring-boot" }
spring-boot-starter-security   = { module = "org.springframework.boot:spring-boot-starter-security", version.ref = "spring-boot" }
spring-boot-starter-actuator   = { module = "org.springframework.boot:spring-boot-starter-actuator", version.ref = "spring-boot" }
spring-boot-starter-validation = { module = "org.springframework.boot:spring-boot-starter-validation", version.ref = "spring-boot" }
flyway-core                    = { module = "org.flywaydb:flyway-core", version.ref = "flyway" }
flyway-postgresql              = { module = "org.flywaydb:flyway-database-postgresql", version.ref = "flyway" }
postgresql                     = { module = "org.postgresql:postgresql", version.ref = "postgresql" }
jsmpp                          = { module = "org.jsmpp:jsmpp", version.ref = "jsmpp" }
esl-client                     = { module = "link.thingscloud:freeswitch-esl-client", version.ref = "esl-client" }
jjwt-api                       = { module = "io.jsonwebtoken:jjwt-api", version = "0.12.6" }
jjwt-impl                      = { module = "io.jsonwebtoken:jjwt-impl", version = "0.12.6" }
jjwt-jackson                   = { module = "io.jsonwebtoken:jjwt-jackson", version = "0.12.6" }
spring-security-crypto         = { module = "org.springframework.security:spring-security-crypto" }
```

---

## 6. Dockerfile pattern (smpp-server)

```dockerfile
# syntax=docker/dockerfile:1.6
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY . .
RUN --mount=type=cache,target=/root/.gradle ./gradlew :smpp-server:bootJar -x test

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN apk add --no-cache curl tini
COPY --from=build /workspace/smpp-server/build/libs/*.jar app.jar
EXPOSE 8080 2775
ENTRYPOINT ["/sbin/tini", "--", "java", "-jar", "/app/app.jar"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/actuator/health/liveness || exit 1
```

(`worker/Dockerfile` tương tự, không expose port, healthcheck: kiểm tra process tồn tại hoặc actuator if web=disabled→thay bằng tcp-check tới rabbitmq từ worker. Chi tiết để phase 1.)

---

## 7. application.yml mapping env

Mọi giá trị nhạy cảm/host đọc env. Pattern:

```yaml
spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST:postgres}:${DB_PORT:5432}/${DB_NAME:smpp_db}
    username: ${DB_USER:smpp_user}
    password: ${DB_PASSWORD}
    hikari:
      maximum-pool-size: ${DB_POOL_SIZE:10}
  data:
    redis:
      host: ${REDIS_HOST:redis}
      port: ${REDIS_PORT:6379}
      password: ${REDIS_PASSWORD}
  rabbitmq:
    host: ${RABBITMQ_HOST:rabbitmq}
    port: ${RABBITMQ_PORT:5672}
    username: ${RABBITMQ_USER:smpp_admin}
    password: ${RABBITMQ_PASSWORD}
    virtual-host: /

app:
  smpp:
    server:
      port: ${SMPP_SERVER_PORT:2775}
      max-binds-per-account: ${SMPP_MAX_BINDS:5}
      enquire-link-interval: ${SMPP_ENQUIRE_LINK:30s}
  jwt:
    secret: ${JWT_SECRET}                    # 32+ bytes, env required
    access-ttl: 1h
    refresh-ttl: 30d
  hmac:
    timestamp-skew: 5m
```

---

## 8. Logging

`logback-spring.xml` ở mỗi service:
- Console appender — JSON format (LogstashEncoder).
- Rolling file `/var/log/app/${serviceName}.log`, daily rotate, max 30 days.
- MDC key chuẩn: `messageId`, `partnerId`, `channelId`, `traceId`.
- Pattern bắt request ID qua filter (vd UUID per HTTP request, propagate vào AMQP message header).

---

## 9. Testing strategy (gợi ý, không bắt buộc phase 1)

- Unit test: domain logic (RouteResolver, HmacSigner, encoding helpers).
- Integration test: Testcontainers PostgreSQL + Redis + RabbitMQ.
- SMPP test: smppsim Docker container as fake telco; jSMPP test client trong test code.
- E2E: docker-compose up, chạy script bash submit message → check DB/Redis state.
