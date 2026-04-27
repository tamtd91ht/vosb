# SMPP Server — Execution Checklist

> Plan đầy đủ (background, risks, verification): `C:\Users\dell\.claude\plans\h-y-l-m-t-ng-b-c-reflective-meerkat.md`.
> File này là **checklist sống** để track tiến độ. Tick `[x]` khi task xong.

---

## 🔁 Resume here for next session

**Trạng thái cuối** (cập nhật `2026-04-27`): **M1 (Phase 1) hoàn tất — T01→T05 ✅**. Sẵn sàng vào **M2 (Phase 2)** bắt đầu T06 (Flyway V1 schema + ADR-012) hoặc T08 song song (security primitives).

### Snapshot

- **Repo state**: Maven multi-module backend (`com.smpp` groupId, package `com.smpp.*`), 1 commit `init` + tất cả T01-T05 chưa commit (làm lúc nào tuỳ user).
- **Build hiện tại**: `./mvnw -B clean package -DskipTests` xanh, 4 modules `smpp-backend / core / smpp-server / worker`. Image `smpp-server:dev` đã build trong Docker.
- **Compose scope** (sau khi user fix): `smpp/backend/docker-compose.yml` **chỉ có `smpp-server`**, join external network `infra-net`. Hạ tầng chạy compose riêng (đã quy hoạch tách từ đầu — prod ở `~/apps/infrastructure/` trên VPS).
- **Local dev infra (orphan)**: 3 container `smpp-postgres / smpp-redis / smpp-rabbitmq` của T05 cũ vẫn chạy trên `smpp-dev_default` network, bind `127.0.0.1:5432/6379/5672`. KHÔNG còn được quản lý bởi compose nào — coi như "infra compose riêng" tạm cho dev. Volumes `smpp-dev_postgres_data` / `smpp-dev_redis_data` / `smpp-dev_rabbitmq_data` giữ data.
- **Endpoint sống** (chạy local qua `java -jar` hoặc `mvnw spring-boot:run` — KHÔNG qua docker-compose locally): `GET /healthz` (DB+Redis+Rabbit qua `localhost`), `GET /readyz`, `GET /api/v1/ping`. 4 sub-router skeleton.

### Quick verify (chạy lại nếu nghi state lệch)

```bash
# 1. Maven build
JAVA_HOME="C:/Program Files/Java/jdk-21.0.11" ./mvnw -B clean package -DskipTests

# 2. Infra orphan (3 container T05) đang chạy?
docker ps --filter "name=smpp-postgres|smpp-redis|smpp-rabbitmq"
# Nếu stopped: docker start smpp-postgres smpp-redis smpp-rabbitmq

# 3. Run app local qua mvn (KHÔNG qua compose) — kết nối localhost:5432/6379/5672
JAVA_HOME="C:/Program Files/Java/jdk-21.0.11" java -jar smpp-server/target/smpp-server-0.1.0-SNAPSHOT.jar &

# 4. Endpoint
curl -fsS http://localhost:8080/healthz       # 200 {db:UP,redis:UP,rabbit:UP}
curl -fsS http://localhost:8080/api/v1/ping   # 200 {"pong":true}
curl -i    http://localhost:8080/api/x         # 404 application/problem+json

# Prod deploy (Phase 10) — KHÔNG dùng locally:
#   docker compose build smpp-server && docker compose up -d
#   (yêu cầu network `infra-net` + .env có secrets)
```

### Environment quirks (đã gặp + cách xử lý)

| Vấn đề | Workaround |
|---|---|
| `JAVA_HOME` hệ thống = JDK 8, project cần JDK 21 | Prefix mọi mvn call: `JAVA_HOME="C:/Program Files/Java/jdk-21.0.11"` |
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

**T06** — Flyway `V1__init.sql` 8 bảng (`partner`, `partner_smpp_account`, `partner_api_key`, `channel`, `route`, `message`, `dlr`, `admin_user`) + seed admin + ADR-012. Cần đổi `application.yml` `spring.flyway.enabled=true`. Update `smpp/docs/data-model.md` + `api.md` (rename `secret_hash` → `secret_encrypted` + `nonce`).

Bắt đầu T06 hoặc T08 (security primitives) song song được.

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

- [ ] **T06** — Flyway `V1__init.sql` 8 bảng + `V900__seed_admin.sql` + ADR-012
  - Files: `core/src/main/resources/db/migration/V1__init.sql`, `V900__seed_admin.sql`, `decisions.md` (ADR-012), update `data-model.md` + `api.md` (`secret_hash` → `secret_encrypted` + `nonce`)
  - Size: M | Depends: T05
  - DoD: `\dt` ra 8 bảng; `partner_api_key.{secret_encrypted bytea, nonce bytea}` đúng.

- [ ] **T07** — JPA entities + Repositories (8 entity)
  - Files: `core/.../domain/*.java`, `core/.../repository/*Repository.java`
  - Size: M | Depends: T06
  - DoD: `@DataJpaTest` (Testcontainers PG) save/find 1 partner xanh.

- [ ] **T08** — Security primitives — bcrypt PasswordHasher + AES-GCM SecretCipher + HmacSigner
  - Files: `core/.../security/{PasswordHasher,SecretCipher,HmacSigner}.java`, unit tests
  - Size: S | Depends: T01 (song song được với T06/T07)
  - DoD: AES-GCM round-trip + bcrypt verify + HMAC vector từ doc khớp.

- [ ] **T09** — JwtService + JwtAuthHandler + AuthContext + BlockingDispatcher
  - Files: `smpp-server/.../auth/{JwtService,JwtAuthHandler,AuthContext,BlockingDispatcher}.java`
  - Size: M | Depends: T04, T07
  - DoD: token sign+verify; reject 401 problem+json; BlockingDispatcher chạy off event loop.

- [ ] **T10** — Admin auth endpoints — login/refresh/logout/me
  - Files: `http/admin/auth/AuthHandlers.java`
  - Size: M | Depends: T09
  - DoD: login với seed admin → JWT; `/me` Bearer → user info; sai pwd → 401.

🏷 **M2 Done — tag `v0.1-phase-2-auth`**

---

## M3 — Admin CRUD (Phase 2 part 2)

- [ ] **T11** — Admin Partners CRUD (5 EP) + soft-delete (Depends: T10, Size: M)
- [ ] **T12** — Admin SMPP-account CRUD (4 EP) (Depends: T11, Size: S)
- [ ] **T13** — Admin API-key CRUD (3 EP) — secret hiện 1 lần, dùng `SecretCipher` (Depends: T11, Size: M)
- [ ] **T14** — Admin Channel CRUD + test-ping (6 EP) (Depends: T11, Size: M)
- [ ] **T15** — Admin Route CRUD (4 EP) (Depends: T11, T14, Size: S)
- [ ] **T16** — Admin Messages search + detail (2 EP) (Depends: T11, Size: S)
- [ ] **T17** — Admin Sessions list + kick (2 EP) — registry stub (Depends: T11, Size: S)
- [ ] **T18** — Admin Stats overview + timeseries (2 EP) (Depends: T11, Size: S)
- [ ] **T19** — Admin Users CRUD (3 EP) (Depends: T11, Size: S)

🏷 **M3 Done — Phase 2 hoàn tất, tag `v0.1-phase-2`**

---

## M4 — SMPP listener inbound (Phase 3)

- [ ] **T20** — jSMPP listener bootstrap + BindAuthenticator
  - Files: `smpp/{SmppServerConfig,BindAuthenticator}.java`
  - Size: M | Depends: T07, T08
  - DoD: bind đúng → ACCEPT; sai → `ESME_RBINDFAIL`; vượt max_binds → reject.

- [ ] **T21** — SessionRegistry full + EnquireLinkScheduler
  - Files: `smpp/{SessionRegistry,EnquireLinkScheduler}.java`
  - Size: M | Depends: T20, T17
  - DoD: session vào Redis hash `smpp:session:<system_id>`; admin `/sessions` thấy; enquire_link 30s.

- [ ] **T22** — submit_sm handler → save Message + publish AMQP `sms.inbound`
  - Files: `smpp/MessageReceiverListenerImpl.java`, `inbound/MessagePublisher.java`, `core/messaging/{Exchanges,Queues,RoutingKeys}.java`
  - Size: M | Depends: T21, T07
  - DoD: submit_sm trả message_id; row `message` state=RECEIVED; `sms.inbound.q` có message.

🏷 **M4 Done — Phase 3 hoàn tất, tag `v0.1-phase-3`**

---

## M5 — Partner HTTP + Internal DLR + Portal (Phase 4 + 6 + 9 partial)

- [ ] **T23** — ApiKeyHmacAuthHandler + Redis replay/skew check
  - Files: `http/auth/ApiKeyHmacAuthHandler.java`, `RedisReplayGuard.java`
  - Size: M | Depends: T08, T13
  - DoD: sai sig → 401; replay → 401; timestamp lệch >5p → 401.

- [ ] **T24** — Partner `/api/v1/messages` 3 EP
  - Files: `http/partner/MessageHandlers.java`, reuse `MessagePublisher`
  - Size: M | Depends: T22, T23
  - DoD: curl HMAC → 202 + message_id; partner chỉ thấy của mình.

- [ ] **T25** — Internal DLR webhook + DlrForwarder
  - Files: `http/internal/DlrIngressHandler.java`, `outbound/DlrForwarder.java`
  - Size: L | Depends: T22
  - DoD: POST `/api/internal/dlr/{ch}` lưu row `dlr`; AMQP `sms.dlr` → forward thành công khi session active hoặc POST webhook fallback.

- [ ] **T26** — Portal 6 EP
  - Files: `http/portal/*Handlers.java`
  - Size: M | Depends: T13, T16, T18
  - DoD: login partner → only data của mình; cố override `partner_id` qua query bị bỏ qua.

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
