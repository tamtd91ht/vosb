# Backend — Spring Boot 3 + jSMPP

Backend là Maven multi-module repo gồm 3 module: `core`, `smpp-server`, `worker`.

---

## 1. Maven multi-module layout

```
smpp/backend/
├── pom.xml                            # parent POM (packaging=pom): <modules> + <dependencyManagement>
├── mvnw, mvnw.cmd                     # Maven Wrapper (UNIX/Windows)
├── .mvn/wrapper/                      # maven-wrapper.properties
├── core/                              # plain library jar, KHÔNG có @SpringBootApplication
│   ├── pom.xml                        # <packaging>jar</packaging> — KHÔNG repackage Spring Boot
│   └── src/main/
│       ├── java/com/smpp/core/
│       │   ├── domain/                # @Entity Partner, Channel, Route, Message, Dlr, ...
│       │   ├── repository/            # Spring Data JPA interface
│       │   ├── dto/                   # DTO chia sẻ giữa smpp-server và worker
│       │   ├── messaging/             # Exchanges, Queues, RoutingKeys constants
│       │   ├── security/              # PasswordHasher, HmacSigner
│       │   └── config/                # @Configuration cho DataSource, Redis, AMQP (auto-import)
│       └── resources/
│           └── db/migration/          # Flyway V1__init.sql, V2__..., V3__...
├── smpp-server/                       # Spring Boot app, có @SpringBootApplication
│   ├── pom.xml                        # depends on `core` + spring-boot-maven-plugin (repackage)
│   ├── Dockerfile                     # multi-stage Java 21
│   └── src/main/
│       ├── java/com/smpp/server/
│       │   ├── ServerApplication.java
│       │   ├── smpp/                  # jSMPP listener (port 2775)
│       │   ├── config/VertxConfig.java # @Bean Vertx, HttpServer, root Router (port 8080)
│       │   ├── auth/                  # JwtService, JwtAuthHandler, AuthContext
│       │   ├── http/                   # Vert.x handlers (KHÔNG Spring MVC)
│       │   │   ├── common/            # HandlerUtils (respondJson, parseBody, ...), BlockingDispatcher, PageResponse
│       │   │   ├── partner/           # /api/v1/* router factory + handlers
│       │   │   ├── admin/             # /api/admin/* router factory + handlers
│       │   │   │   ├── auth/          # AuthHandlers (login/refresh/logout/me)
│       │   │   │   ├── partner/       # PartnerHandlers, SmppAccountHandlers, ApiKeyHandlers
│       │   │   │   ├── channel/       # ChannelHandlers (CRUD + test-ping)
│       │   │   │   ├── route/         # RouteHandlers
│       │   │   │   ├── message/       # MessageHandlers (read-only)
│       │   │   │   ├── session/       # SessionHandlers (stub, Phase 3)
│       │   │   │   ├── stats/         # StatsHandlers (overview + timeseries)
│       │   │   │   ├── user/          # UserHandlers
│       │   │   │   └── dto/           # PageResponse<T>
│       │   │   ├── portal/            # /api/portal/* router factory + handlers
│       │   │   ├── internal/          # /api/internal/* (DLR webhook, ...)
│       │   │   └── error/             # ProblemJsonFailureHandler (RFC 7807)
│       │   ├── inbound/               # MessagePublisher (publish sms.inbound)
│       │   └── outbound/              # DlrForwarder (consume sms.dlr)
│       └── resources/
│           ├── application.yml
│           └── application-prod.yml
├── worker/                            # Spring Boot app, web=none
│   ├── pom.xml                        # depends on `core` + spring-boot-maven-plugin
│   ├── Dockerfile
│   └── src/main/
│       ├── java/com/smpp/worker/
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
| `domain` | `@Entity` JPA classes mapping bảng SQL: `Partner`, `PartnerSmppAccount`, `PartnerApiKey`, `Channel`, `Route`, `Message`, `Dlr`, `AdminUser` + 11 enums + `JsonNodeConverter` (JSONB AttributeConverter) |
| `repository` | `interface XxxRepository extends JpaRepository<...>` |
| `dto` | Record/POJO dùng cho REST + AMQP (vd `InboundMessageEvent`, `DlrEvent`) |
| `messaging` | Constants `Exchanges.SMS_INBOUND="sms.inbound"`, `Queues.SMS_INBOUND_Q="sms.inbound.q"`, `RoutingKeys.partner(id)` |
| `security` | `PasswordHasher` (bcrypt wrapper), `SecretCipher` (AES-GCM-256 encrypt/decrypt), `HmacSigner` (HMAC-SHA-256 sign + verify) |
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

### 3.3 HTTP API — Vert.x Web (KHÔNG Spring MVC)

Quyết định: REST layer dùng **Vert.x Web**, Spring Boot chỉ giữ vòng đời/DI/config (xem **ADR-010** + `.claude/rules/vertx-rest.md`).

`config/VertxConfig.java` — sở hữu `Vertx`, `HttpServer`, root `Router`. 4 sub-router (`partnerRouter`, `adminRouter`, `portalRouter`, `internalRouter`) là `@Component` factory expose `Router` bean, được mount theo path prefix.

**Admin router (Phase 2 — đã implement)**: `AdminRouterFactory` mount JWT guard (`JwtAuthHandler`) cho toàn bộ `/api/admin/*` trừ `/auth/login` và `/auth/refresh`, sau đó delegate sang các handler:

| Handler | Endpoints |
|---|---|
| `AuthHandlers` | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |
| `PartnerHandlers` | CRUD `/partners` (5 EP) |
| `SmppAccountHandlers` | CRUD `/partners/:id/smpp-accounts` (4 EP) |
| `ApiKeyHandlers` | CRUD `/partners/:id/api-keys` (3 EP) |
| `ChannelHandlers` | CRUD `/channels` + `POST /channels/:id/test-ping` (6 EP) |
| `RouteHandlers` | CRUD `/routes` (4 EP) |
| `MessageHandlers` | Read-only `/messages` (2 EP) |
| `SessionHandlers` | Stub `/sessions` (Phase 3) |
| `StatsHandlers` | `GET /stats/overview`, `GET /stats/timeseries` |
| `UserHandlers` | CRUD `/users` (4 EP) |

`http/common/HandlerUtils.java` — static helpers dùng chung cho mọi handler: `respondJson`, `parseBody`, `getPage`, `getSize`, `pathLong`, `handleError`, `asyncRespond`, `mapper()`. `http/admin/dto/PageResponse.java` — `record PageResponse<T>(List<T> items, long total, int page, int size)`.


```java
@Configuration
public class VertxConfig {

    @Bean(destroyMethod = "close")
    public Vertx vertx() {
        return Vertx.vertx();
    }

    @Bean
    public Router rootRouter(Vertx vertx,
                             @Qualifier("partnerRouter")  Router partner,
                             @Qualifier("adminRouter")    Router admin,
                             @Qualifier("portalRouter")   Router portal,
                             @Qualifier("internalRouter") Router internal) {
        Router root = Router.router(vertx);
        root.route().handler(BodyHandler.create());
        root.route("/api/v1/*").subRouter(partner);
        root.route("/api/admin/*").subRouter(admin);
        root.route("/api/portal/*").subRouter(portal);
        root.route("/api/internal/*").subRouter(internal);
        return root;
    }

    @Bean(destroyMethod = "close")
    public HttpServer httpServer(Vertx vertx, Router root,
                                 @Value("${app.http.port:8080}") int port) {
        HttpServer server = vertx.createHttpServer().requestHandler(root);
        server.listen(port).toCompletionStage().toCompletableFuture().join();
        return server;
    }
}
```

Auth handler (Vert.x `AuthenticationHandler`) gắn ở từng sub-router:

```java
@Component("partnerRouter")
public class PartnerRouterFactory {
    public PartnerRouterFactory(Vertx vertx,
                                ApiKeyHmacAuthHandler hmacAuth,
                                MessagesHandler messages,
                                ProblemJsonFailureHandler onFailure) {
        Router r = Router.router(vertx);
        r.route().handler(hmacAuth);                         // 401 nếu fail
        r.post("/messages").handler(messages::create);
        r.get("/messages/:id").handler(messages::getById);
        r.route().failureHandler(onFailure);
        this.router = r;
    }
    @Bean("partnerRouter") public Router router() { return router; }
}
```

Blocking call (JPA, JDBC, jSMPP submit) phải chạy qua `vertx.executeBlocking(...)` hoặc inject `@Service` chạy trên thread-pool riêng — KHÔNG block event loop.

Actuator chạy ở port phụ qua **Jetty embedded** (`management.server.port=8081`, loopback only) để không lẫn với Vert.x HTTP server. Nginx KHÔNG forward 8081 ra public.

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

Parent POM (`smpp/backend/pom.xml`) inherit `spring-boot-starter-parent` để hưởng dependency-management Spring Boot, chỉ khai báo thêm version cho lib bên thứ ba (jSMPP, ESL, JJWT). Spring Boot starters/Postgres/Flyway lấy version từ BOM của parent.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.3.0</version>
        <relativePath/>
    </parent>

    <groupId>com.smpp</groupId>
    <artifactId>smpp-backend</artifactId>
    <version>0.1.0-SNAPSHOT</version>
    <packaging>pom</packaging>

    <modules>
        <module>core</module>
        <module>smpp-server</module>
        <module>worker</module>
    </modules>

    <properties>
        <java.version>21</java.version>
        <vertx.version>4.5.10</vertx.version>
        <jsmpp.version>3.0.0</jsmpp.version>
        <esl-client.version>0.9.2</esl-client.version>
        <jjwt.version>0.12.6</jjwt.version>
    </properties>

    <dependencyManagement>
        <dependencies>
            <dependency>
                <groupId>io.vertx</groupId>
                <artifactId>vertx-stack-depchain</artifactId>
                <version>${vertx.version}</version>
                <type>pom</type>
                <scope>import</scope>
            </dependency>
            <dependency>
                <groupId>com.smpp</groupId>
                <artifactId>core</artifactId>
                <version>${project.version}</version>
            </dependency>
            <dependency>
                <groupId>org.jsmpp</groupId>
                <artifactId>jsmpp</artifactId>
                <version>${jsmpp.version}</version>
            </dependency>
            <dependency>
                <groupId>link.thingscloud</groupId>
                <artifactId>freeswitch-esl-client</artifactId>
                <version>${esl-client.version}</version>
            </dependency>
            <dependency>
                <groupId>io.jsonwebtoken</groupId>
                <artifactId>jjwt-api</artifactId>
                <version>${jjwt.version}</version>
            </dependency>
            <dependency>
                <groupId>io.jsonwebtoken</groupId>
                <artifactId>jjwt-impl</artifactId>
                <version>${jjwt.version}</version>
            </dependency>
            <dependency>
                <groupId>io.jsonwebtoken</groupId>
                <artifactId>jjwt-jackson</artifactId>
                <version>${jjwt.version}</version>
            </dependency>
        </dependencies>
    </dependencyManagement>
</project>
```

Module `smpp-server/pom.xml` (rút gọn) — depend `core` + Spring Boot starters cần dùng + apply plugin `repackage`:

```xml
<project>
    <parent>
        <groupId>com.smpp</groupId>
        <artifactId>smpp-backend</artifactId>
        <version>0.1.0-SNAPSHOT</version>
    </parent>
    <artifactId>smpp-server</artifactId>

    <dependencies>
        <dependency><groupId>com.smpp</groupId><artifactId>core</artifactId></dependency>
        <!-- Spring Boot: bootstrap + DI + lifecycle. KHÔNG starter-web (xem ADR-010). -->
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-amqp</artifactId></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-redis</artifactId></dependency>
        <!-- Actuator chạy ở port phụ 8081 qua Jetty (loopback). -->
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-actuator</artifactId></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-jetty</artifactId></dependency>
        <!-- HTTP/REST = Vert.x Web. Auth/handler tự viết, KHÔNG dùng Spring Security filter. -->
        <dependency><groupId>io.vertx</groupId><artifactId>vertx-core</artifactId></dependency>
        <dependency><groupId>io.vertx</groupId><artifactId>vertx-web</artifactId></dependency>
        <dependency><groupId>io.vertx</groupId><artifactId>vertx-web-validation</artifactId></dependency>
        <dependency><groupId>io.vertx</groupId><artifactId>vertx-web-client</artifactId></dependency>
        <dependency><groupId>io.vertx</groupId><artifactId>vertx-auth-jwt</artifactId></dependency>
        <!-- Password hashing (bcrypt) — gọn, không cần kéo Spring Security đầy đủ. -->
        <dependency><groupId>org.springframework.security</groupId><artifactId>spring-security-crypto</artifactId></dependency>
        <dependency><groupId>org.flywaydb</groupId><artifactId>flyway-core</artifactId></dependency>
        <dependency><groupId>org.flywaydb</groupId><artifactId>flyway-database-postgresql</artifactId></dependency>
        <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId></dependency>
        <dependency><groupId>org.jsmpp</groupId><artifactId>jsmpp</artifactId></dependency>
        <dependency><groupId>io.jsonwebtoken</groupId><artifactId>jjwt-api</artifactId></dependency>
        <dependency><groupId>io.jsonwebtoken</groupId><artifactId>jjwt-impl</artifactId><scope>runtime</scope></dependency>
        <dependency><groupId>io.jsonwebtoken</groupId><artifactId>jjwt-jackson</artifactId><scope>runtime</scope></dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
        </plugins>
    </build>
</project>
```

Module `worker/pom.xml` tương tự nhưng **không cần Vert.x Web** (worker không expose HTTP server). Outbound HTTP gọi 3rd-party dùng `vertx-web-client` HOẶC `java.net.http.HttpClient` (JDK 21). Thêm `link.thingscloud:freeswitch-esl-client` cho ESL.

Module `core/pom.xml` chỉ là library jar — **KHÔNG** apply `spring-boot-maven-plugin` (tránh executable jar):

```xml
<project>
    <parent>...smpp-backend...</parent>
    <artifactId>core</artifactId>
    <packaging>jar</packaging>
    <dependencies>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-jpa</artifactId></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-data-redis</artifactId></dependency>
        <dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter-amqp</artifactId></dependency>
        <dependency><groupId>org.flywaydb</groupId><artifactId>flyway-core</artifactId></dependency>
        <dependency><groupId>org.postgresql</groupId><artifactId>postgresql</artifactId></dependency>
    </dependencies>
</project>
```

---

## 6. Dockerfile pattern (smpp-server)

```dockerfile
# syntax=docker/dockerfile:1.6
FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY .mvn .mvn
COPY mvnw pom.xml ./
COPY core/pom.xml core/
COPY smpp-server/pom.xml smpp-server/
COPY worker/pom.xml worker/
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -pl smpp-server -am dependency:go-offline
COPY core/src core/src
COPY smpp-server/src smpp-server/src
RUN --mount=type=cache,target=/root/.m2 ./mvnw -B -pl smpp-server -am package -DskipTests

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
RUN apk add --no-cache curl tini
COPY --from=build /workspace/smpp-server/target/*.jar app.jar
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
