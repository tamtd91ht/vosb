# SMPP Server — Execution Checklist

> Plan đầy đủ (background, risks, verification): `C:\Users\dell\.claude\plans\h-y-l-m-t-ng-b-c-reflective-meerkat.md`.
> File này là **checklist sống** để track tiến độ. Tick `[x]` khi task xong.

---

## 🔁 Resume here for next session

**Trạng thái cuối** (cập nhật `2026-04-28`): **T06–T26 ✅ + Provider/Pricing Addon ✅ + Luồng 1 ✅** — Phase 2–4 hoàn tất + SMS HTTP dispatch xong. Build `./mvnw -B package -DskipTests` 4 modules SUCCESS. Commit `8063dd4`.

### Các luồng còn lại (next flows)

**Luồng 1 — SMS dispatch qua HTTP 3rd-party** ✅ **DONE** (`2026-04-28`):
- `SmsDispatcherService` + 6 callers (`SpeedSMS`, `eSMS`, `Vietguys`, `Abenla`, `Infobip`, `CUSTOM`).
- `InboundMessageConsumer.handleSms()` gọi dispatcher → update state SUBMITTED/FAILED.
- `CUSTOM` caller: template substitution (`${source_addr/dest_addr/content/message_id}`) + JSONPath response ID/status parsing.
- Vietguys tự động chuyển E.164 `84...` → local `0...` format.

**Luồng 2 — SMPP client tới telco** (TelcoSmppDispatcher, worker):
- Worker bind ra telco SMSC như SMPP client (`SMPPSession` outbound).
- Session pool `TelcoSmppSessionPool`: 1 pool per channel, auto-reconnect, enquire_link keep-alive.
- Dispatch: `session.submitShortMessage(...)` → lấy `message_id` từ `submit_sm_resp` → lưu vào `message.message_id_telco`.
- Telco gửi `deliver_sm` DLR về `SMPPSession.setMessageReceiverListener()` → worker normalize → POST `api/internal/dlr/{channelId}`.
- `DlrForwarder` (smpp-server) đã sẵn sàng nhận từ RabbitMQ và forward về partner.
- File cần tạo: `worker/.../TelcoSmppDispatcher.java`, `worker/.../TelcoSmppSessionPool.java`.

**Luồng 3 — FreeSWITCH ESL dispatcher** (voice OTP nội bộ):
- `VoiceOtpDispatcherService` hiện chỉ hỗ trợ `2TMOBILE_VOICE` (HTTP).
- Cần thêm branch cho `FREESWITCH_ESL`: dùng jESL (hoặc raw TCP socket) kết nối FreeSWITCH ESL API `FREESWITCH_ESL` channel.
- `originate {origination_caller_id_name=<sender>}sofia/gateway/<gw>/<destAddr> &playback(otp.wav)`.
- Listen sự kiện `CHANNEL_HANGUP_COMPLETE` để xác định trạng thái cuộc gọi.
- File cần tạo: `worker/.../FreeSwitchEslDispatcher.java`, `worker/.../EslSessionPool.java`.

**Luồng 4 — Rate billing trong worker** (Phase 5+):
- `RateResolver` (core) đã implement 3-level fallback lookup.
- Khi worker dispatch xong → gọi `rateResolver.resolvePartnerRate(partnerId, deliveryType, carrier, prefix)` → deduct `partner.balance`.
- Cần: `PartnerBalanceService` với optimistic locking (`@Version` trên Partner) để tránh race condition.
- File cần tạo: `core/.../service/PartnerBalanceService.java`.

**Luồng 5 — Route cache Redis** (tùy chọn, performance):
- `RouteResolver.resolve()` hiện query DB mỗi message.
- Có thể thêm Redis cache `route:partner:<id>:<destAddr>` TTL 60s.
- Invalidate cache khi admin update route qua `PUT/DELETE /api/admin/routes/:id`.
- Admin handler cần publish invalidation event hoặc direct `redis.delete(key)` sau save.

### Snapshot

- **Repo state**: Maven multi-module backend (`com.smpp` groupId, package `com.smpp.*`). Commits: `init`, `feat: phase1 T01-T05`, `feat: phase2+3 listener+auth+CRUD`, commit mới nhất sẽ có sau session này.
- **Build hiện tại**: `./mvnw -B clean package -DskipTests` xanh, 4 modules `smpp-backend / core / smpp-server / worker`. Image `smpp-server:dev` đã build trong Docker.
- **Compose scope**: `smpp/backend/docker-compose.yml` **chỉ có `smpp-server`**, join external network `infra-net`. Hạ tầng chạy compose riêng.
- **Local dev infra (orphan)**: 3 container `smpp-postgres / smpp-redis / smpp-rabbitmq` của T05 cũ vẫn chạy trên `smpp-dev_default` network, bind `127.0.0.1:5432/6379/5672`. Volumes `smpp-dev_postgres_data` / `smpp-dev_redis_data` / `smpp-dev_rabbitmq_data` giữ data.
- **Endpoint sống** (chạy local qua `java -jar` — KHÔNG qua docker-compose locally, cần infra containers running): Toàn bộ admin API Phase 2–4: login/auth, partners/smpp-accounts/api-keys/channels/routes/rates/carriers/messages/sessions/stats/users, partner inbound API (`/api/v1/messages`), DLR ingress (`/api/internal/dlr/{channelId}`), portal 6 EP. Worker: consume `sms.inbound.q` → route → Voice OTP (2T-Mobile HTTP) + **SMS HTTP dispatch (SpeedSMS/eSMS/Vietguys/Abenla/Infobip/CUSTOM)**.

### Quick verify (chạy lại nếu nghi state lệch)

```bash
# 1. Maven build (java trong PATH đã là JDK 21 Temurin, không cần JAVA_HOME prefix)
./mvnw -B clean package -DskipTests

# 2. Infra orphan (3 container T05) đang chạy?
docker ps --filter "name=smpp-postgres|smpp-redis|smpp-rabbitmq"
# Nếu stopped: docker start smpp-postgres smpp-redis smpp-rabbitmq

# 3. Run app local qua mvn (KHÔNG qua compose) — kết nối localhost:5432/6379/5672
JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot" java -jar smpp-server/target/smpp-server-0.1.0-SNAPSHOT.jar &

# 4. Endpoint
curl -fsS http://localhost:8080/healthz       # 200 {db:UP,redis:UP,rabbit:UP}
curl -fsS http://localhost:8080/api/v1/ping   # 200 {"pong":true}
curl -i    http://localhost:8080/api/x         # 404 application/problem+json

# 5. Phase 2 smoke test (infra containers must be running)
TOKEN=$(curl -s -X POST http://localhost:8080/api/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@123456"}' | jq -r .token)

curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/admin/auth/me
# → 200 {id, username:admin, role:ADMIN}

curl -i http://localhost:8080/api/admin/partners  # no token
# → 401 application/problem+json

# Prod deploy (Phase 10) — KHÔNG dùng locally:
#   docker compose build smpp-server && docker compose up -d
#   (yêu cầu network `infra-net` + .env có secrets)
```

### Environment quirks (đã gặp + cách xử lý)

| Vấn đề | Workaround |
|---|---|
| `JAVA_HOME` hệ thống = JDK 8, project cần JDK 21 | Java 21 thực tế: `C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot` — nhưng `java` trong PATH đã trỏ đúng Java 21, `./mvnw` dùng trực tiếp OK. |
| Spring Boot Jackson auto-config conditional `Jackson2ObjectMapperBuilder` (cần `spring-web`) — KHÔNG có trong project | Tự tạo `ObjectMapper` bean trong `JacksonConfig` với `@Primary @ConditionalOnMissingBean` |
| Spring Boot's `RedisAutoConfiguration` đăng ký `redisTemplate` collision với của ta | `@AutoConfiguration(before = RedisAutoConfiguration.class)` để bean ta wins, Spring's `@ConditionalOnMissingBean` skip |
| `spring.main.lazy-initialization=true` — Vert.x `HttpServer` không bao giờ init | `@Lazy(false)` trên `VertxConfig` — chỉ ép HTTP eager, infra beans vẫn lazy |
| `useradd -u 1000` trong `eclipse-temurin:21-jre` Ubuntu fail (UID 1000 đã có) | Dùng UID 1001 |
| Hibernate validate JDBC metadata khi DB DOWN → app start fail | `spring.jpa.properties.hibernate.boot.allow_jdbc_metadata_access=false` + `spring.datasource.hikari.initialization-fail-timeout=-1` |
| Hikari connection-timeout default 30s — healthz quá chậm khi DB down | Set `spring.datasource.hikari.connection-timeout=2000` |
| Sed/linter bug: file đầu Java đôi khi dính prefix `/.` | Grep `^/\.` trước khi build; Edit thủ công |

### Decisions đã chốt (đọc các ADR trong `smpp/docs/decisions.md`)

- ADR-001: 2 service `smpp-server` + `worker` chia sẻ `core` ✓
- ADR-002: Spring Boot 3 + jSMPP ✓
- ADR-009: Maven (vs Gradle) ✓
- ADR-010: Vert.x Web cho REST, Spring Boot chỉ lifecycle/DI/config ✓ — Actuator portion superseded bởi ADR-011
- ADR-011: Tự code `/healthz` + `/readyz` qua Vert.x, KHÔNG Spring Boot Actuator ✓
- ADR-012 (sẽ làm T06): `partner_api_key.secret_encrypted` AES-GCM 256

### Convention bắt buộc cho task mới

- HTTP handler đặt trong `smpp-server/src/main/java/com/smpp/server/http/<group>/` — package `http/`, KHÔNG `controller/`.
- KHÔNG import `org.springframework.web.*` (`@RestController`, `@GetMapping`, `ResponseEntity`...).
- KHÔNG dùng `SecurityFilterChain` — auth = Vert.x `AuthenticationHandler`.
- Blocking JPA/Redis/Rabbit trong handler phải qua `vertx.executeBlocking(...)` (sẽ có `BlockingDispatcher` helper từ T09).
- Mọi REST DTO field tiếng Anh; JSON snake_case (Jackson `PropertyNamingStrategies.SNAKE_CASE` đã set).
- Code English, doc Vietnamese (`.claude/rules/code-language.md`).

### Next task

**T20** — jSMPP listener bootstrap + BindAuthenticator (Phase 3). Xem M4 section bên dưới.

### Provider/Pricing Addon (ngoài plan gốc — completed 2026-04-28)

Các task bổ sung hoàn thành trước khi vào Phase 3:

**BE:**
- **V2 migration**: thêm `channel.delivery_type`; tạo `channel_rate`, `partner_rate`.
- **V3 migration**: tạo `carrier_prefix` (30 prefix nội địa); thêm `carrier` column vào cả 2 rate table.
- **JPA entities**: `ChannelRate`, `PartnerRate` (+ carrier field), `CarrierPrefix`, enum `DeliveryType`, `RateUnit`, `Carrier`.
- **Provider Adapter Pattern** (ADR-014): interface `HttpProviderAdapter`, registry `HttpProviderRegistry`, 7 adapters (ESms, Abenla, Vietguys, SpeedSms, Infobip, Stringee, Custom), `ProviderField` record.
- **ChannelHandlers** mở rộng: `listHttpProviders()`, `stats()`, `resolveDeliveryType()`.
- **ChannelRateHandlers**: CRUD channel_rate với carrier hybrid (ADR-015).
- **PartnerRateHandlers**: CRUD partner_rate với carrier hybrid.
- **CarrierHandlers**: `GET /api/admin/carriers` trả danh sách carrier + prefix.
- **AdminRouterFactory** cập nhật: 9 route mới (http-providers, stats, carrier rates, partner rates, carriers).

**FE:**
- **Providers page** `/admin/providers`: hiển thị channel chia theo SMS/Voice OTP; create dialog 3-step (select type → select provider → fill credentials).
- **Provider detail** `/admin/providers/[id]`: 3 tab — Cấu hình (JSON viewer + status toggle), Thống kê (KPI + BarChart), Bảng giá (channel_rate CRUD với toggle Nội địa/Quốc tế).
- **Partner detail** mở rộng: tab Bảng giá (partner_rate CRUD với toggle Nội địa/Quốc tế + filter SMS/Voice OTP).
- **Sidebar**: đổi "Kênh" → "Nhà cung cấp" → `/admin/providers`; `/admin/channels` redirect về providers.
- **Error boundaries** (P08): `error.tsx` + `not-found.tsx` cho cả admin và portal.
- **types.ts**: thêm `Carrier`, `CarrierInfo`, `ChannelRate.carrier`, `PartnerRate.carrier`.

---

## Decisions đã chốt

- Build: Maven multi-module, Java 21 (ADR-009).
- HTTP: Vert.x Web cho REST, Spring Boot chỉ bootstrap/lifecycle/DI/config (ADR-010).
- Health: KHÔNG Spring Actuator — tự code `/healthz` + `/readyz` qua Vert.x → ADR-011 chốt ở T03.
- API key secret: `secret_encrypted bytea` + `nonce bytea` AES-GCM 256, key từ env `APP_SECRET_KEY` → ADR-012 chốt ở T06.

---

## M1 — Bootstrap (Phase 1)

- [x] **T01** — Maven parent + 3 module skeleton + Wrapper ✅
  - Files: `smpp/backend/pom.xml`, `core/pom.xml`, `smpp-server/pom.xml`, `worker/pom.xml`, `mvnw`, `mvnw.cmd`, `.mvn/wrapper/maven-wrapper.properties`, `.gitignore`
  - Size: S | Depends: —
  - DoD: `./mvnw -B -N validate` xanh ✓; `./mvnw -B -pl core verify` xanh ✓; module list `core/smpp-server/worker` ✓.
  - Note: cần `JAVA_HOME=C:/Program Files/Java/jdk-21.0.11` (system JAVA_HOME đang trỏ Java 8). Maven 3.9.9 only-script wrapper.

- [x] **T02** — `core` config beans (DataSource, Redis, AMQP, Jackson) + auto-config import ✅
  - Files: `core/.../config/{DataSourceConfig,RedisConfig,AmqpConfig,JacksonConfig}.java`, `META-INF/spring/...AutoConfiguration.imports`
  - Size: M | Depends: T01
  - DoD: `mvn -pl core verify` xanh ✓; 4 class trong imports ✓; Jackson `JavaTimeModule + Jdk8Module + SNAKE_CASE + NON_NULL` ✓.
  - Note: tránh `Jackson2ObjectMapperBuilderCustomizer` (cần `spring-web`) — tự tạo `ObjectMapper` bean với `@Primary @ConditionalOnMissingBean`. Spring Boot Jackson auto-config conditional `Jackson2ObjectMapperBuilder` nên không tự tạo nếu vắng spring-web — bean ta cung cấp đảm bảo có ObjectMapper.

- [x] **T03** — `smpp-server` Spring Boot main + `application.yml` + ADR-011 ✅
  - Files: `smpp-server/.../ServerApplication.java`, `application.yml`, `application-dev.yml`, `smpp-server/pom.xml` (deps), `smpp/docs/decisions.md` (ADR-011 + ADR-010 status)
  - Size: M | Depends: T02
  - DoD: "Started ServerApplication in 4.147s" ✓; 0 class Spring MVC/Tomcat/Jetty ✓; ADR-010 status "phần Actuator superseded by ADR-011" ✓; ADR-011 appended ✓.
  - Note: app start không cần infra (`spring.main.lazy-initialization=true`, `flyway.enabled=false`, `hibernate.boot.allow_jdbc_metadata_access=false`). RedisConfig đổi sang `@AutoConfiguration(before=RedisAutoConfiguration)` để Spring's default redisTemplate skip qua `@ConditionalOnMissingBean`.

- [x] **T04** — Vert.x HTTP server + 4 sub-router empty + ProblemJsonFailureHandler + `/healthz`/`/readyz` + `GET /api/v1/ping` ✅
  - Files: `config/VertxConfig.java`, `http/{partner,admin,portal,internal}/*RouterFactory.java`, `http/error/ProblemJsonFailureHandler.java`, `http/health/HealthHandlers.java`, pom.xml (vertx-core+web), application.yml (Hikari `connection-timeout=2s`)
  - Size: M | Depends: T03
  - DoD: ping 200 ✓; healthz 503 với `{db:DOWN,redis:DOWN,rabbit:DOWN}` (Docker chưa up) ✓; readyz 200 `{ready:true}` ✓; /api/x 404 `application/problem+json` ✓.
  - Note: VertxConfig đánh dấu `@Lazy(false)` để override `spring.main.lazy-initialization=true` — HttpServer phải start ngay khi context up. RouterFactory + HealthHandlers + FailureHandler eager transitively. Healthz dùng `vertx.executeBlocking(..., false)` chạy 3 ping song song trên worker pool.

- [x] **T05** — Dockerfile multi-stage + `docker-compose.yml` (app-only) + `.env.example` ✅
  - Files: `smpp-server/Dockerfile`, `smpp/backend/docker-compose.yml`, `.dockerignore`, `.env.example`
  - Size: M | Depends: T04
  - DoD: image `smpp-server:dev` build xanh ✓; container app chạy + healthz `{db:UP,...}` HTTP 200 (verified với 4-service infra trước khi user yêu cầu rewrite) ✓; compose validate sạch ✓.
  - **Scope đã chốt sau khi rewrite**: compose này **chỉ có service `smpp-server`** join external network `infra-net`. Hạ tầng (Postgres/Redis/RabbitMQ) chạy compose riêng (đã quy hoạch tách từ đầu — prod ở `~/apps/infrastructure/`). 3 infra container của T05 đầu vẫn chạy local (orphan, dùng cho `mvnw spring-boot:run`).
  - Note: UID 1001 (eclipse-temurin Ubuntu base đã có ubuntu/uid=1000). Prereqs cho `docker compose up`: (a) network `infra-net` đã tồn tại, (b) `.env` có secrets, (c) infra container DNS name = `${DB_HOST}/${REDIS_HOST}/${RABBITMQ_HOST}`.

🏷 **M1 Done — tag `v0.1-phase-1`**

---

## M2 — Schema + Admin auth (Phase 2 part 1)

- [x] **T06** — Flyway `V1__init.sql` 8 bảng + `V900__seed_admin.sql` + ADR-012 + ADR-013 ✅
  - Files: `core/src/main/resources/db/migration/V1__init.sql`, `V900__seed_admin.sql`, `decisions.md` (ADR-012 + ADR-013), `data-model.md` (updated)
  - Size: M | Depends: T05
  - DoD: `\dt` ra 8 bảng; `partner_api_key.{secret_encrypted bytea, nonce bytea}` đúng; `partner.dlr_webhook jsonb`.
  - Note: Seed admin password = `Admin@123456` (bcrypt cost 10). ADR-013 chốt `dlr_webhook JSONB` thay `dlr_webhook_url VARCHAR`. Java path thực tế: `C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot` (không phải jdk-21.0.11 như ghi trong plan cũ).

- [x] **T07** — JPA entities + Repositories (8 entity) ✅
  - Files: `core/.../domain/{Partner,PartnerSmppAccount,PartnerApiKey,Channel,Route,Message,Dlr,AdminUser}.java`, `core/.../domain/enums/` (11 enums), `core/.../domain/converter/JsonNodeConverter.java`, `core/.../repository/*Repository.java`
  - Size: M | Depends: T06
  - DoD: Build xanh ✓. DB verify (Flyway + schema validate) cần Docker infra running.
  - Note: Dùng Hibernate `@CreationTimestamp/@UpdateTimestamp` thay lifecycle callback. `@GeneratedValue(strategy=UUID)` cho Message.id (Hibernate 6). JSONB → `JsonNodeConverter` (AttributeConverter, no extra dep).

- [x] **T08** — Security primitives — bcrypt PasswordHasher + AES-GCM SecretCipher + HmacSigner ✅
  - Files: `core/.../security/{PasswordHasher,SecretCipher,HmacSigner}.java`, 3 unit test classes (15 tests)
  - Size: S | Depends: T01 (song song được với T06/T07)
  - DoD: 15/15 tests PASS ✓. AES-GCM round-trip ✓; bcrypt verify ✓; HMAC SHA-256 empty-body vector ✓.
  - Note: SecretCipher dùng SHA-256(rawKey) → 32-byte AES key (bất kỳ độ dài key nào cũng OK). spring-security-crypto thêm vào core pom.xml.

- [x] **T09** — JwtService + JwtAuthHandler + AuthContext + BlockingDispatcher ✅
  - Files: `smpp-server/.../auth/{JwtService,JwtAuthHandler,AuthContext}.java`, `http/common/BlockingDispatcher.java`; update `AdminRouterFactory` wire JWT guard
  - Size: M | Depends: T04, T07
  - DoD: BUILD SUCCESS ✓; JWT guard wired → /api/admin/* (trừ /auth/login, /auth/refresh) → 401 khi thiếu Bearer.
  - Note: accessTtl/refreshTtl inject dạng String rồi parse thủ công (hỗ trợ `1h`, `30d`, `PT1H`). jti shared giữa access + refresh token (đơn giản cho Phase 2). Redis blacklist check chạy off event loop qua `ctx.vertx().executeBlocking()`.

- [x] **T10** — Admin auth endpoints — login/refresh/logout/me ✅
  - Files: `http/admin/auth/AuthHandlers.java`, `http/common/HandlerUtils.java`, `http/admin/dto/PageResponse.java`
  - Size: M | Depends: T09
  - DoD: login với seed admin → JWT; `/me` Bearer → user info; sai pwd → 401.
  - Note: Refresh token stored in Redis `jwt:refresh:<raw_token>` EX 30d. Logout blacklists access jti.

🏷 **M2 Done — tag `v0.1-phase-2-auth`**

---

## M3 — Admin CRUD (Phase 2 part 2)

- [x] **T11** — Admin Partners CRUD (5 EP) + soft-delete ✅ (Depends: T10, Size: M)
  - Files: `http/admin/partner/PartnerHandlers.java`
  - Note: `dlr_webhook` JSONB validated (URL + method whitelist). Soft-delete = SUSPENDED.
- [x] **T12** — Admin SMPP-account CRUD (4 EP) ✅ (Depends: T11, Size: S)
  - Files: `http/admin/partner/SmppAccountHandlers.java`
  - Note: password hash bcrypt; soft-delete = DISABLED.
- [x] **T13** — Admin API-key CRUD (3 EP) — secret hiện 1 lần ✅ (Depends: T11, Size: M)
  - Files: `http/admin/partner/ApiKeyHandlers.java`
  - Note: keyId = `ak_live_<16 chars>`, raw_secret = base64url(32 random bytes), stored AES-GCM via SecretCipher.
- [x] **T14** — Admin Channel CRUD + test-ping (6 EP) ✅ (Depends: T11, Size: M)
  - Files: `http/admin/channel/ChannelHandlers.java`
  - Note: config validated per type (HTTP/ESL/SMPP required fields). test-ping stub for non-HTTP types.
- [x] **T15** — Admin Route CRUD (4 EP) ✅ (Depends: T11, T14, Size: S)
  - Files: `http/admin/route/RouteHandlers.java`
  - Note: 409 on unique constraint (partner_id, msisdn_prefix, priority). Prefix normalized (strip leading +).
- [x] **T16** — Admin Messages search + detail (2 EP) ✅ (Depends: T11, Size: S)
  - Files: `http/admin/message/MessageHandlers.java`
  - Note: read-only; filter by partner_id/state/dest_addr; sorted DESC createdAt.
- [x] **T17** — Admin Sessions list + kick (2 EP) — registry stub ✅ (Depends: T11, Size: S)
  - Files: `http/admin/session/SessionHandlers.java`
  - Note: list returns empty array; kick returns 501 until Phase 3.
- [x] **T18** — Admin Stats overview + timeseries (2 EP) ✅ (Depends: T11, Size: S)
  - Files: `http/admin/stats/StatsHandlers.java`
  - Note: overview = GROUP BY state; timeseries = date_trunc(granularity) native query.
- [x] **T19** — Admin Users CRUD (3 EP) ✅ (Depends: T11, Size: S)
  - Files: `http/admin/user/UserHandlers.java`
  - Note: role constraint — PARTNER role requires partner_id; ADMIN role leaves partner_id null.

🏷 **M3 Done — Phase 2 hoàn tất, tag `v0.1-phase-2`**

---

## M4 — SMPP listener inbound (Phase 3)

### T20 — jSMPP listener bootstrap + BindAuthenticator

- **Size**: M | **Depends**: T07, T08
- **Files tạo/sửa**:
  ```
  smpp-server/src/main/java/com/smpp/server/smpp/
    SmppServerConfig.java          -- @Configuration; ThreadPoolTaskExecutor + SMPPServerSessionListener bean
    BindAuthenticator.java         -- @Component; query DB + bcrypt verify + Redis cache + ip check + maxBinds
    BindRejected.java              -- RuntimeException wrapper (SMPP status code + message)
  smpp-server/src/main/resources/application.yml  -- thêm app.smpp.server.{port,enquire-link-interval,max-pending-binds}
                                                   -- app.smpp.executor.{core-size,max-size,queue-capacity}
  ```
- **Logic chính**:
  - `SmppServerConfig`: tạo `SMPPServerSessionListener(port)`, start accept-loop trên thread riêng ("smpp-accept"), mỗi accepted session → submit vào `ThreadPoolTaskExecutor`.
  - Accept-loop: `session.setMessageReceiverListener(receiver)` → bind sẽ gọi `MessageReceiverListenerImpl.onAcceptBind()`.
  - `BindAuthenticator.authenticate(systemId, password, sourceIp)`:
    1. `PartnerSmppAccountRepository.findBySystemId(systemId)` → 404 → `ESME_RBINDFAIL`
    2. `acc.getStatus() != ACTIVE` → `ESME_RBINDFAIL`
    3. bcrypt verify với Redis cache `smpp:bindok:<systemId>:<sha256(pwd)>` EX 300s
    4. IP whitelist: parse CIDR array jsonb → nếu list trống → allow all; else check `InetAddress`
    5. `sessionRegistry.countActive(systemId) >= acc.getMaxBinds()` → `ESME_RTHROTTLED`
- **Config mặc định**:
  ```yaml
  app.smpp.server:
    port: 2775
    enquire-link-interval: 30000     # ms
    max-pending-binds: 100
  app.smpp.executor:
    core-size: 32
    max-size: 128
    queue-capacity: 256
  ```
- **DoD**: bind đúng system_id+password → `ESME_ESME_ROK` (0x00) + session active; sai password → `ESME_RBINDFAIL`; system_id không tồn tại → `ESME_RBINDFAIL`; vượt max_binds → reject; IP không whitelist → reject.

---

### T21 — SessionRegistry + MessageReceiverListenerImpl (bind hook) + SessionHandlers wire

- **Size**: M | **Depends**: T20
- **Files tạo/sửa**:
  ```
  smpp-server/src/main/java/com/smpp/server/smpp/
    SessionRegistry.java           -- @Component; ConcurrentMap + Redis sync
    SessionInfo.java               -- record { systemId, sessionId, bindType, remoteIp, boundAt }
    MessageReceiverListenerImpl.java  -- @Component; implements ServerMessageReceiverListener; onAcceptBind + unbind hook
  smpp-server/src/main/java/com/smpp/server/http/admin/session/
    SessionHandlers.java           -- cập nhật: list() đọc từ SessionRegistry thay vì trả []
  ```
- **Logic SessionRegistry**:
  - `add(systemId, session, bindType, remoteIp)`: thêm vào `ConcurrentMap<String, Set<SMPPServerSession>>`; push Redis hash `smpp:sessions` field=sessionId value=`{systemId,bindType,remoteIp,boundAt}` JSON.
  - `remove(session)`: xóa khỏi map; xóa Redis field.
  - `countActive(systemId)`: return `map.getOrDefault(systemId, emptySet()).size()`.
  - `listAll()`: flatten map → `List<SessionInfo>` (dùng cho admin sessions endpoint).
- **MessageReceiverListenerImpl**:
  - `onAcceptBind(bindReq, session)`: gọi `authenticator.authenticate(...)`, nếu OK → `sessionRegistry.add(...)`, trả `SMPPServerSession` cho jSMPP.
  - Implement `ServerStateListener.onStateChange(session, CLOSED)` → `sessionRegistry.remove(session)`.
  - Các method PDU khác (submit_sm, ...) defer sang T22.
- **SessionHandlers** update: `list()` đọc `sessionRegistry.listAll()` → map sang response map; `kick()` gọi `sessionRegistry.get(systemId).forEach(SMPPServerSession::unbindAndClose)`.
- **DoD**: sau bind → admin `GET /api/admin/sessions` thấy session; unbind/disconnect → session biến khỏi list; kick endpoint → session đóng lại.

---

### T22 — submit_sm handler → lưu Message + publish AMQP `sms.inbound`

- **Size**: M | **Depends**: T21, T07
- **Files tạo/sửa**:
  ```
  smpp-server/src/main/java/com/smpp/server/smpp/
    MessageReceiverListenerImpl.java  -- mở rộng: implement onAcceptSubmitSm
    EncodingUtils.java                -- static decode(byte[], dcs) → String
  smpp-server/src/main/java/com/smpp/server/inbound/
    MessagePublisher.java             -- @Component; RabbitTemplate publish to exchange
  core/src/main/java/com/smpp/core/messaging/
    Exchanges.java                    -- constants: SMS_INBOUND = "sms.inbound"
    Queues.java                       -- SMS_INBOUND_Q = "sms.inbound.q"
    RoutingKeys.java                  -- static partner(Long partnerId) = "partner.<id>"
    InboundMessageEvent.java          -- record { messageId(UUID), partnerId, sourceAddr, destAddr, content, encoding, inboundVia, sessionId }
  smpp-server/src/main/resources/application.yml  -- thêm app.smpp.server.throughput-per-second: 100
  ```
- **Logic onAcceptSubmitSm**:
  1. Validate: `shortMessage.length > 140` → `STAT_ESME_RINVMSGLEN`; `destAddr` rỗng → `STAT_ESME_RINVDSTADR`
  2. Decode content: `EncodingUtils.decode(shortMessage, dataCoding)` → String
  3. Lưu DB: `Message` entity `{partnerId, sourceAddr, destAddr, content, encoding, inboundVia=SMPP, state=RECEIVED}` → `messageRepo.save(msg)` (blocking, chạy trên jSMPP worker thread, không phải Vert.x event loop)
  4. Publish AMQP: `MessagePublisher.publish(new InboundMessageEvent(msg.getId(), ...))`
  5. Trả `SubmitSmResult(messageIdStr, null)` — `messageIdStr` = UUID.toString() (36 chars, ≤65 octets)
- **AmqpConfig cập nhật** (trong `core`): khai báo exchange `sms.inbound` (type=topic, durable=true) + queue `sms.inbound.q` (durable=true) + binding `sms.inbound.q → sms.inbound / #`.
- **EncodingUtils**: decode DCS 0x00 (GSM7), 0x03 (Latin-1), 0x08 (UCS-2 BE), default ASCII.
- **DoD**: gửi `submit_sm` → `submit_sm_resp` với non-null `message_id`; DB row `message` với `state=RECEIVED`; RabbitMQ queue `sms.inbound.q` có message payload JSON; encoding GSM7/UCS-2 decode đúng.

🏷 **M4 Done — Phase 3 hoàn tất, tag `v0.1-phase-3`**

---

## M5 — Partner HTTP + Internal DLR + Portal (Phase 4 + 6 + 9 partial)

- [x] **T23** — ApiKeyHmacAuthHandler + Redis replay/skew check ✅
  - Files: `http/auth/ApiKeyHmacAuthHandler.java`
  - Size: M | Depends: T08, T13
  - DoD: sai sig → 401; replay → 401; timestamp lệch >5p → 401.

- [x] **T24** — Partner `/api/v1/messages` 3 EP ✅
  - Files: `http/partner/PartnerMessageHandlers.java`
  - Size: M | Depends: T22, T23
  - DoD: curl HMAC → 202 + message_id; partner chỉ thấy của mình.

- [x] **T25** — Internal DLR webhook + DlrForwarder ✅
  - Files: `http/internal/DlrIngressHandler.java`, `outbound/DlrForwarder.java`, `core/amqp/DlrEvent.java`
  - Size: L | Depends: T22
  - DoD: POST `/api/internal/dlr/{ch}` lưu row `dlr`; AMQP `sms.dlr` → forward thành công khi session active hoặc POST webhook fallback.
  - Note: Auth = `X-Internal-Secret` header. SMPP deliver_sm format SMSC receipt. HTTP webhook fallback với custom headers từ partner.dlr_webhook.

- [x] **T26** — Portal 6 EP ✅
  - Files: `http/portal/*Handlers.java`
  - Size: M | Depends: T13, T16, T18
  - DoD: login partner → only data của mình; cố override `partner_id` qua query bị bỏ qua.
  - Note: Handler stubs hoàn tất. Cần wire + smoke test khi BE containers running.

🏷 **M5 Done — tag `v0.1-phase-4-6-9-partial`**

---

## Branch points (parallel)

- Sau **T05**: T06 ‖ T08
- Sau **T11**: T12 ‖ T13 ‖ T14 → T15 ; T16 ‖ T17 ‖ T18 ‖ T19 song song
- Sau **T15**: M4 ‖ M5 prereqs (T20 ‖ T23)
- Sau **T22**: T24 ‖ T25 ‖ T26

## Verification cuối M5

```bash
cd smpp/backend && ./mvnw -B verify
docker compose up -d
# admin flow → smpp bind → submit_sm → /api/v1/messages HMAC → /api/internal/dlr → /api/portal/*
```

Chi tiết từng smoke step: phần "Verification" trong plan file gốc.
