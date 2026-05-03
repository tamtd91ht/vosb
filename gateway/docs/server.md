# server.md — Tổng quan Backend VOSB Gateway

> **Mục đích**: Tài liệu reference đầy đủ cho backend, dùng làm ngữ cảnh cho Claude Code và dev mới khi phát triển. Để biết tiến độ và resume point xem `gateway/smpp-plan.md`. Để biết hạ tầng đã chạy xem `gateway/docs/infras.md`.
>
> **Nguyên tắc**: Code tiếng Anh, doc tiếng Việt, giữ thuật ngữ kỹ thuật. Mọi thay đổi schema phải qua Flyway migration mới (V*__*.sql). Mọi quyết định kiến trúc mới phải có ADR trong `decisions.md`.

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Cấu trúc module Maven](#2-cấu-trúc-module-maven)
3. [Stack & quyết định kiến trúc](#3-stack--quyết-định-kiến-trúc)
4. [Domain model](#4-domain-model)
5. [Database & Flyway migrations](#5-database--flyway-migrations)
6. [HTTP layer (Vert.x Web)](#6-http-layer-vertx-web)
7. [SMPP Server inbound (port 2775)](#7-smpp-server-inbound-port-2775)
8. [Worker — 5 luồng dispatch](#8-worker--5-luồng-dispatch)
9. [Authentication & security](#9-authentication--security)
10. [AMQP topology](#10-amqp-topology)
11. [Configuration & environment](#11-configuration--environment)
12. [Build, run, deploy](#12-build-run-deploy)
13. [Testing](#13-testing)
14. [Known limitations & next phases](#14-known-limitations--next-phases)

---

## 1. Tổng quan

VOSB Gateway là **aggregator gateway** cho SMS và Voice OTP. Mô hình:

```
                ┌──────────────────────────────────────────┐
                │           PARTNERS (đối tác)              │
                │  có thể submit message qua 2 channel:     │
                │  - SMPP (port 2775, system_id+password)   │
                │  - HTTP API (HMAC SHA-256 signature)      │
                └──────────────┬───────────────────────────┘
                               │
                ┌──────────────▼───────────────┐
                │       smpp-server JAR         │
                │  - Vert.x HTTP @ 8080         │
                │  - jSMPP listener @ 2775      │
                │  - Auth (JWT/HMAC/internal)   │
                │  - Persist Message → DB       │
                │  - Publish → RabbitMQ         │
                └──────┬────────────────┬───────┘
                       │                │
                  Postgres 16      RabbitMQ 3.13
                       │                │
                       │      ┌─────────▼──────────┐
                       │      │     worker JAR      │
                       │      │  consume → resolve  │
                       │      │  route → dispatch:  │
                       │      │  ├─ HTTP 3rd-party  │
                       │      │  ├─ Telco SMPP      │
                       │      │  └─ FreeSWITCH ESL  │
                       │      │  → bill partner     │
                       │      └────────┬────────────┘
                       │               │
                       │      ┌────────▼───────────────┐
                       │      │  Telco SMSC / IVRS /   │
                       │      │  HTTP provider / ...   │
                       │      └────────┬───────────────┘
                       │               │ DLR (delivery receipt)
                       │      ┌────────▼───────┐
                       │      │  DLR forwarder │ ← Redis (route/replay cache)
                       │      └────────┬───────┘
                       │               │
                       └───────────────┘
                            update Message.state, push DLR về partner webhook/SMPP
```

**3 hướng dispatch chính** (channel.type):
- `HTTP_THIRD_PARTY` — SMS qua HTTP API của đối tác cung cấp (SpeedSMS, eSMS, Vietguys, Abenla, Infobip, hoặc CUSTOM template)
- `TELCO_SMPP` — Outbound SMPP client tới SMSC của telco (Viettel, Mobifone…)
- `FREESWITCH_ESL` — Voice OTP qua FreeSWITCH ESL (originate call + TTS playback)

**Routing logic** (`RouteResolver`):
1. Carrier-based: từ `dest_addr` (E.164) → resolve carrier qua bảng `carrier_prefix` → match `route.carrier`
2. Prefix-based fallback: longest-prefix match trên `route.msisdn_prefix`, sort theo `priority DESC`
3. Cache Redis 60s, invalidate per partner khi route/channel thay đổi

---

## 2. Cấu trúc module Maven

Project tại `D:\works\vosb\gateway\backend\` — Maven multi-module:

```
backend/
├── pom.xml                       # parent POM
├── docker-compose.yml            # smpp-server service, mount infra-net
├── core/                         # shared library (jar)
│   ├── pom.xml
│   └── src/main/java/com/vosb/gateway/core/
│       ├── domain/               # JPA entities + enums
│       ├── repository/           # Spring Data JPA interfaces
│       ├── config/               # AmqpConfig, JpaConfig, RedisConfig, JacksonConfig
│       ├── security/             # PasswordHasher, HmacSigner, SecretCipher
│       ├── service/              # PartnerBalanceService, RateResolver, CarrierResolver
│       ├── messaging/            # AMQP DTO/event records (InboundMessageEvent, DlrEvent)
│       └── util/                 # JsonNodeConverter, ...
├── smpp-server/                  # Spring Boot app (jar)
│   ├── pom.xml
│   ├── Dockerfile                # multi-stage temurin:21
│   └── src/main/java/com/vosb/gateway/server/
│       ├── ServerApplication.java       # @SpringBootApplication
│       ├── config/                      # VertxConfig, ...
│       ├── http/                        # Vert.x routers + handlers
│       │   ├── admin/                   # AdminRouterFactory + */*Handlers
│       │   ├── portal/                  # PortalRouterFactory
│       │   ├── partner/                 # PartnerRouterFactory (HTTP API)
│       │   ├── internal/                # InternalRouterFactory (DLR ingress)
│       │   ├── auth/                    # JwtAuthHandler, ApiKeyHmacAuthHandler, ...
│       │   ├── error/                   # ProblemJsonFailureHandler (RFC 7807)
│       │   └── common/                  # HandlerUtils, BlockingDispatcher
│       └── smpp/                        # SMPP server bootstrap, BindAuthenticator, SessionRegistry
└── worker/                       # Spring Boot app (jar)
    ├── pom.xml
    └── src/main/java/com/vosb/gateway/worker/
        ├── WorkerApplication.java       # @SpringBootApplication, web=none
        ├── InboundMessageConsumer.java  # @RabbitListener("sms.inbound.q")
        ├── RouteResolver.java           # Redis-cached
        ├── SmsDispatcherService.java    # branch by ChannelType
        ├── VoiceOtpDispatcherService.java
        ├── http/                        # 6 caller (SpeedSMS, eSMS, Vietguys, Abenla, Infobip, CUSTOM)
        ├── telco/                       # TelcoSmppDispatcher, TelcoSmppSessionPool, TelcoDlrProcessor
        ├── esl/                         # FreeSwitchEslDispatcher, EslConnectionPool, EslDlrProcessor
        └── dlr/                         # DlrForwarder (forward to partner webhook or SMPP)
```

### POM dependencies

| Module | Packaging | Phụ thuộc chính |
|---|---|---|
| `gateway-backend` (parent) | pom | Spring Boot 3.3.0 BOM, Java 21, UTF-8, jSMPP 3.0.0, Vert.x 4.5.10, JJWT 0.12.6, freeswitch-esl 2.2.0, Lombok |
| `core` | jar | spring-boot-starter-data-jpa, spring-boot-starter-data-redis (Lettuce), spring-boot-starter-amqp, flyway-core + flyway-database-postgresql, postgresql, spring-security-crypto (BCrypt), jackson-jsr310 |
| `smpp-server` | jar (Spring Boot) | core, spring-boot-starter, vertx-core, vertx-web, jsmpp, jjwt-api/impl/jackson |
| `worker` | jar (Spring Boot) | core, spring-boot-starter (web=none), jsmpp (outbound client), freeswitch-esl |

Build plugin: `spring-boot-maven-plugin` ở `smpp-server` và `worker` (tạo executable JAR), không có ở `core`.

### Docker
- `smpp-server/Dockerfile` — multi-stage `eclipse-temurin:21-jdk` (build) → `:21-jre` (runtime), non-root user `smpp:smpp` (uid 1001), entrypoint `tini`, expose 8080 + 2775, healthcheck `curl /healthz`.
- `backend/docker-compose.yml` — chỉ có service `smpp-server`, attach external network `infra-net` (Postgres/Redis/RabbitMQ chạy compose riêng ở `infra/`). Port bind mặc định `127.0.0.1:8080` và `127.0.0.1:2775` — public chỉ qua Nginx (xem `nginx.md`).

---

## 3. Stack & quyết định kiến trúc

| Quyết định | Lý do | Tham chiếu |
|---|---|---|
| **Spring Boot chỉ làm bootstrap/DI/config**, KHÔNG dùng Spring MVC/WebFlux | Vert.x cho HTTP performance + non-blocking. Tránh kéo Tomcat. | ADR-010, `.claude/rules/vertx-rest.md` |
| **Vert.x Web cho REST** (`io.vertx.ext.web.Router`) | Single event-loop, async, light-weight | ADR-010 |
| **JPA/JDBC blocking** chạy qua `BlockingDispatcher` (`vertx.executeBlocking`) | Không block event loop khi truy vấn DB | `http/common/BlockingDispatcher.java` |
| **jSMPP 3.0.0** cho cả listener (server) và outbound client (worker) | Mature, production-grade | `smpp-server/smpp/`, `worker/telco/` |
| **Worker tách JAR riêng** | Scale dispatch độc lập với HTTP API; isolate failure | `worker/` module |
| **2 service share `core` module** | DRY entity/repo/service | Maven multi-module |
| **Flyway** cho schema migration | Reproducible, version-controlled DB | `core/src/main/resources/db/migration/` |
| **Redis** cho route cache (60s TTL) + JWT blacklist + HMAC replay | Tránh DB hit cho hot path | ADR (xem `decisions.md`) |
| **RabbitMQ** topic exchange decouple HTTP/SMPP ingress khỏi worker | Backpressure + retry | `core/config/AmqpConfig.java` |
| **HMAC SHA-256** cho partner HTTP API (không dùng JWT) | Stateless, signature-based, replay-safe | `auth/ApiKeyHmacAuthHandler.java` |
| **AES-GCM-256** cho partner_api_key.secret | Reversible (cần plaintext để verify HMAC), không dùng bcrypt | ADR-012 |
| **BCrypt** cho password (admin_user, partner_smpp_account) | One-way hash | `security/PasswordHasher.java` |
| **Hybrid routing**: carrier vs msisdn_prefix mutually exclusive per partner | Đơn giản hóa cấu hình; partial unique indexes enforce | V4 migration |
| **Optimistic locking** trên `message` (`@Version`) | Tránh race condition khi worker concurrent update state | `Message.version` |
| **Atomic balance deduct**: `UPDATE ... WHERE balance >= :amount` | Concurrent-safe, không cần `@Version` trên Partner | `PartnerRepository.deductBalance` |

---

## 4. Domain model

10 entity + 14 enum, package `com.vosb.gateway.core.domain.*`.

### Entities

| Class | Bảng | Trường chính | Ghi chú |
|---|---|---|---|
| `Partner` | `partner` | id (BIGSERIAL PK), code (UNIQUE 64), name, status (ACTIVE/SUSPENDED), dlr_webhook (JSONB), balance (NUMERIC 18,4), createdAt, updatedAt | DLR webhook null = không forward HTTP |
| `PartnerSmppAccount` | `partner_smpp_account` | id, partnerId (FK), systemId (UNIQUE 16), passwordHash (bcrypt), maxBinds (default 5), ipWhitelist (JSONB array CIDR), status | Empty whitelist = allow all |
| `PartnerApiKey` | `partner_api_key` | id, partnerId (FK), keyId (UNIQUE 32, format `ak_live_*`), secretEncrypted (BYTEA), nonce (BYTEA 12), label, status (ACTIVE/REVOKED), lastUsedAt | Secret AES-GCM-256, plaintext không lưu |
| `Channel` | `channel` | id, code (UNIQUE), name, type (HTTP_THIRD_PARTY/FREESWITCH_ESL/TELCO_SMPP), config (JSONB), deliveryType (SMS/VOICE_OTP), status | config schema theo type |
| `ChannelRate` | `channel_rate` | channelId (FK), prefix (default ''), carrier (nullable), rate (NUMERIC 18,6), currency, unit (MESSAGE/SECOND/CALL), effectiveFrom (DATE), effectiveTo (DATE nullable) | carrier XOR prefix |
| `Route` | `route` | partnerId (FK), msisdnPrefix (16), carrier (nullable), channelId (FK), fallbackChannelId (FK), priority (default 100), enabled | carrier XOR prefix; partial unique indexes |
| `Message` | `message` | id (UUID PK), partnerId, channelId (nullable), sourceAddr, destAddr, content (TEXT), encoding (GSM7/UCS2/LATIN1), inboundVia (SMPP/HTTP), state, messageIdTelco, errorCode, version (`@Version`), createdAt, updatedAt | Optimistic locking |
| `Dlr` | `dlr` | id, messageId (FK UUID), state (DELIVERED/FAILED/EXPIRED/UNKNOWN), errorCode, rawPayload (JSONB), source (TELCO_SMPP/HTTP_WEBHOOK/FREESWITCH_ESL), receivedAt | `@PrePersist` set receivedAt nếu null |
| `AdminUser` | `admin_user` | id, username (UNIQUE), passwordHash (bcrypt), role (ADMIN/PARTNER), partnerId (FK nullable, NOT NULL nếu role=PARTNER), enabled, lastLoginAt | Login flow update lastLoginAt |
| `PartnerRate` | `partner_rate` | partnerId, deliveryType, prefix (default ''), carrier (nullable), rate, currency (VND), unit, effectiveFrom, effectiveTo | Pricing partner trả gateway |
| `CarrierPrefix` | `carrier_prefix` | prefix (PK 8), carrier | Lookup E.164 → carrier (32 prefix VN) |

### Enums (`domain/enums/`)

```
AdminRole         { ADMIN, PARTNER }
Carrier           { VIETTEL, MOBIFONE, VINAPHONE, VIETNAMOBILE, GMOBILE, REDDI }
ChannelStatus     { ACTIVE, DISABLED }
ChannelType       { HTTP_THIRD_PARTY, FREESWITCH_ESL, TELCO_SMPP }
DeliveryType      { SMS, VOICE_OTP }
DlrSource         { TELCO_SMPP, HTTP_WEBHOOK, FREESWITCH_ESL }
DlrState          { DELIVERED, FAILED, EXPIRED, UNKNOWN }
InboundVia        { SMPP, HTTP }
KeyStatus         { ACTIVE, REVOKED }
MessageEncoding   { GSM7, UCS2, LATIN1 }
MessageState      { RECEIVED, ROUTED, SUBMITTED, DELIVERED, FAILED }
PartnerStatus     { ACTIVE, SUSPENDED }
RateUnit          { MESSAGE, SECOND, CALL }
SmppAccountStatus { ACTIVE, DISABLED }
```

### Repositories (`core/repository/`)

11 interface, đều extend `JpaRepository<E, K>`. Custom queries:

| Repository | Method nổi bật |
|---|---|
| `AdminUserRepository` | `findByUsername(String)` |
| `CarrierPrefixRepository` | `findByCarrier(String)` |
| `ChannelRepository` | `findByCode(String)`, `findAllByType(ChannelType)` |
| `ChannelRateRepository` | `findActiveByChannelAndCarrier`, `findActiveByChannelAndPrefix`, `findActiveWildcardByChannel` (3 lookup theo (carrier, prefix, wildcard) × hiệu lực `effective_from/to`) |
| `DlrRepository` | `findByMessageId(UUID)` |
| `MessageRepository` | `updateState(UUID, MessageState, String)`, `updateStateAndTelcoId(...)` (custom `@Modifying @Query`) |
| `PartnerRepository` | `findByCode(String)`, `deductBalance(Long, BigDecimal)` (atomic SQL) |
| `PartnerApiKeyRepository` | `findByKeyIdAndStatus(String, KeyStatus)` |
| `PartnerRateRepository` | tương tự ChannelRateRepository (carrier/prefix/wildcard) |
| `PartnerSmppAccountRepository` | `findBySystemId(String)` |
| `RouteRepository` | `findByPartnerIdAndCarrierAndEnabledTrue(...)`, `findByPartnerIdAndCarrierIsNullAndEnabledTrueOrderByPriorityDescMsisdnPrefixDesc(...)` |

---

## 5. Database & Flyway migrations

Schema tại `core/src/main/resources/db/migration/`. Flyway run **chỉ ở `smpp-server`** (worker disabled).

| File | Tóm tắt |
|---|---|
| `V1__init.sql` | 8 bảng cốt lõi: partner, partner_smpp_account, partner_api_key, channel, route, message, dlr, admin_user. CHECK constraints cho status/state/inbound_via. Indexes cơ bản (status, partner_created, message.state). UNIQUE (partner_id, msisdn_prefix, priority) trên route. |
| `V2__provider_pricing.sql` | Thêm `channel.delivery_type` (default SMS, FREESWITCH_ESL backfill VOICE_OTP). Tạo `channel_rate` + `partner_rate` (rate NUMERIC 18,6, prefix default '', effective range). |
| `V3__carrier_prefix.sql` | Tạo `carrier_prefix` (PK=prefix, FK=carrier). Add cột `carrier` vào `channel_rate` + `partner_rate` (nullable). Partial indexes `WHERE carrier IS NOT NULL`. |
| `V4__add_route_carrier.sql` | Add `route.carrier` (nullable). Drop UNIQUE cũ → tạo 2 partial unique indexes: `route_partner_carrier_uidx` (carrier-based) + `route_partner_prefix_priority_uidx` (prefix-based). |
| `V5__seed_carrier_prefix.sql` | Seed 32 prefix Việt Nam (idempotent `ON CONFLICT DO NOTHING`): VIETTEL (8486-8498, 8432-8439…), MOBIFONE, VINAPHONE, VIETNAMOBILE, GMOBILE, REDDI. |
| `V900__seed_admin.sql` | Seed admin user `admin / Admin@123456` (bcrypt). |

### Hybrid routing & rate logic (V3 + V4)

Để hiểu **carrier XOR prefix**:
- Trên `route`, `channel_rate`, `partner_rate`: `carrier IS NOT NULL` ⇒ áp dụng cho **tất cả số trong nhà mạng đó (nội địa)**. `carrier IS NULL` ⇒ áp dụng theo `prefix` (quốc tế hoặc legacy).
- Partial unique indexes ngăn 1 partner có cùng lúc 2 route mâu thuẫn.

### Khi sửa schema

**Quy tắc** (từ `flyway-migration-author` agent):
1. **Không** edit migration đã apply ở môi trường khác. Tạo file mới `V<n+1>__*.sql`.
2. Naming `V<n>__<snake_case_summary>.sql`.
3. Sync `gateway/docs/data-model.md` (Mermaid ERD) sau mỗi migration.
4. Chạy `./mvnw -pl smpp-server spring-boot:run` để Flyway tự apply ở local.

---

## 6. HTTP layer (Vert.x Web)

### Bootstrap

`smpp-server/.../config/VertxConfig.java` định nghĩa các `@Bean`:

```java
@Bean(destroyMethod = "close") public Vertx vertx()        // single Vertx instance
@Bean public Router rootRouter(...)                         // mount sub-routers + global handlers
@Bean public HttpServer httpServer(Vertx, Router, port)     // listen on app.http.port (default 8080), block until ready
```

`rootRouter` mount theo thứ tự:
1. CORS handler (preflight OPTIONS, allowed origins từ `${app.cors.allowed-origins:http://localhost:3000,http://127.0.0.1:3000}`) — **phải trước BodyHandler**
2. `BodyHandler.create()` (buffer body cho HMAC verify)
3. Health probes: `GET /healthz`, `GET /readyz`
4. Sub-routers: `/api/v1/*`, `/api/admin/*`, `/api/portal/*`, `/api/internal/*`
5. Catch-all 404 (RFC 7807)
6. Global `failureHandler` = `ProblemJsonFailureHandler`

### 4 sub-router

| Bean qualifier | Path prefix | Auth | Class |
|---|---|---|---|
| `partnerRouter` | `/api/v1/*` | `ApiKeyHmacAuthHandler` (HMAC SHA-256) | `http/partner/PartnerRouterFactory.java` |
| `adminRouter` | `/api/admin/*` | `JwtAuthHandler` (Bearer JWT) — login/refresh public | `http/admin/AdminRouterFactory.java` |
| `portalRouter` | `/api/portal/*` | `JwtAuthHandler` + role=PARTNER + IDOR check (partnerId từ JWT claim) | `http/portal/PortalRouterFactory.java` |
| `internalRouter` | `/api/internal/*` | `X-Internal-Secret` header | `http/internal/InternalRouterFactory.java` |

### Endpoints — Partner HTTP API (`/api/v1/*`)

Auth: `X-Api-Key`, `X-Timestamp`, `X-Signature`. HMAC canonical: `{METHOD}\n{PATH}\n{BODY_HEX}\n{TIMESTAMP}`.

| Method | Path | Mô tả |
|---|---|---|
| GET | `/ping` | Health (no auth) |
| POST | `/api/v1/messages` | Submit message; body `{source_addr, dest_addr, content, encoding?}`; resp 202 `{message_id, status, created_at}` |
| GET | `/api/v1/messages` | List partner's messages (paginated) |
| GET | `/api/v1/messages/:id` | Get single message |

E.164 normalization: `+`, `00`, leading `0` cho VN; validate 7–15 digits.

### Endpoints — Admin (`/api/admin/*`)

Public:
- `POST /auth/login` — body `{username, password}` → `{token, refresh_token, expires_in}`
- `POST /auth/refresh` — body `{refresh_token}` → `{token, expires_in}`

Protected (JWT):
- `POST /auth/logout` — blacklist jti vào Redis (TTL = remaining exp)
- `GET /auth/me` — `{id, username, role, partner_id}`

**Partners CRUD** (T11):
- `POST/GET/PUT/DELETE /partners[/:id]`
- DELETE = soft-delete (status=SUSPENDED)

**SMPP Accounts** (T12, nested):
- `POST/GET /partners/:partnerId/smpp-accounts[/:id]`
- `DELETE` soft (status=DISABLED). **Không có PUT** ở phase hiện tại.

**API Keys** (T13, nested):
- `POST /partners/:partnerId/api-keys` → trả `{key_id, raw_secret, label}` (secret hiển thị 1 lần duy nhất)
- `GET /partners/:partnerId/api-keys` (không trả secret)
- `DELETE /partners/:partnerId/api-keys/:id` (revoke)

**Channels** (T14):
- `POST/GET/PUT/DELETE /channels[/:id]`
- `GET /channels/http-providers` — metadata 6 provider HTTP (đặt **trước** `:id` route do precedence)
- `POST /channels/:id/test-ping` — **Phase 2 stub** (trả message hardcoded)
- `GET /channels/:id/stats?period=today|7d|30d`

**Channel Rates** (nested under channels):
- `POST/GET/PUT/DELETE /channels/:id/rates[/:rateId]`
- carrier XOR prefix; effective_from default today

**Partner Rates** (nested under partners):
- `POST/GET/PUT/DELETE /partners/:partnerId/rates[/:rateId]`
- Filter `?delivery_type=SMS|VOICE_OTP`

**Carriers** (lookup):
- `GET /carriers` — list 6 carrier + prefixes

**Routes** (T15):
- `POST/GET/PUT/DELETE /routes[/:id]`
- carrier XOR msisdn_prefix; channel + fallback phải ACTIVE; trả `warnings[]` nếu rate coverage thiếu
- `PUT` invalidate cache route Redis cho partner đó

**Messages** (T16, read-only):
- `GET /messages?page=&size=&partner_id=&state=&dest_addr=`
- `GET /messages/:id`

**Sessions** (T17):
- `GET /sessions` — `{items: SessionInfo[], total}`
- `DELETE /sessions/:id` — `unbindAndClose()` jSMPP session

**Stats** (T18):
- `GET /stats/overview` → counts theo MessageState
- `GET /stats/timeseries?granularity=hour|day&from=ISO&to=ISO`

**Admin Users** (T19):
- `POST/GET/PUT /users[/:id]` (không có DELETE — disable bằng `enabled=false`)

### Endpoints — Portal (`/api/portal/*`)

Auth: JWT, role=PARTNER, partnerId luôn lấy từ claim (IDOR-safe).

| Method | Path | Mô tả |
|---|---|---|
| GET | `/overview` | Dashboard partner: balance, stats theo state, delivery_rate |
| GET | `/messages[/:id]` | Lịch sử message của chính partner |
| GET/POST | `/api-keys` | List + tạo (secret hiển thị 1 lần) |
| POST | `/api-keys/:id/revoke` | Revoke key |
| GET | `/smpp-accounts` | List SMPP account của partner |
| POST | `/smpp-accounts/:id/change-password` | Đổi password (≥8 ký tự, bcrypt) |
| PATCH | `/webhook` | Update DLR webhook `{url, method, headers}` (validate URL, method ∈ GET/POST/PUT/PATCH) |

### Endpoints — Internal (`/api/internal/*`)

Auth: `X-Internal-Secret: ${app.internal.secret:dev-internal-secret-change-me}`.

- `POST /dlr/:channelId` — DLR ingress từ HTTP provider hoặc worker dispatcher. Body `{telco_message_id, state, error_code?, ...}`. Flow: lookup message theo telco_message_id → tạo Dlr → update message.state → publish `DlrEvent` (routing key `dlr.{partnerId}`) cho `DlrForwarder` xử lý outbound.

### Auth handlers

#### `JwtAuthHandler` (`http/auth/JwtAuthHandler.java`)
1. Parse Bearer token → verify chữ ký HS256 (key: SHA-256 của `${app.jwt.secret}`)
2. Redis blacklist check: `jwt:bl:{jti}` (`executeBlocking` để không block event loop)
3. Inject `AuthContext(userId, username, role, partnerId, jti)` vào `ctx.data("auth")`
4. Fail 401 + RFC 7807

#### `ApiKeyHmacAuthHandler` (`http/auth/ApiKeyHmacAuthHandler.java`)
1. Extract keyId từ `X-Api-Key`
2. Validate timestamp skew (`${app.hmac.timestamp-skew-seconds:300}`)
3. Lookup `partner_api_key` ACTIVE → decrypt AES-GCM secret bằng nonce trong row
4. Tính HMAC SHA-256 canonical → compare X-Signature (constant-time)
5. Replay-safe: lưu signature vào Redis `hmac:replay:{sig}` TTL 600s, reject duplicate
6. Inject `PartnerContext(partnerId, keyId)` vào `ctx.data("partner")`

#### `JwtService` (`http/auth/JwtService.java`)
- Sign: HS256, claims `{username, role, partner_id, type, jti, exp, iat}`
- Token pair: `access-ttl` 1h, `refresh-ttl` 30d (configurable)
- `reissueAccess(refreshToken)` giữ nguyên jti
- Blacklist khi logout: `jwt:bl:{jti}` TTL = remaining

### Failure handler (RFC 7807)

`http/error/ProblemJsonFailureHandler.java`:
```json
{
  "type": "about:blank",
  "title": "Forbidden",
  "status": 403,
  "instance": "/api/admin/partners/42",
  "detail": "Insufficient permission"
}
```
Content-Type: `application/problem+json`. 5xx log ERROR + stack, 4xx log DEBUG.

### Common helpers (`http/common/`)

- `HandlerUtils` — `respondJson(ctx, status, body)`, `parseBody(ctx, Class)`, `pathLong(ctx, name)`, `handleError(ctx, err)`
- `BlockingDispatcher` — `executeAsync(Callable)` chạy JPA/JDBC trên thread pool riêng, trả `Future<T>` để chain `.onSuccess/.onFailure` với Vert.x

---

## 7. SMPP Server inbound (port 2775)

`smpp-server/.../smpp/`:

### `SmppServerConfig.java`
- `@Bean smppExecutor` — `ThreadPoolTaskExecutor` (core 32, max 128, queue 256, daemon, prefix `smpp-session-`)
- `@Bean smppServerSessionListener` — `new SMPPServerSessionListener(${app.smpp.port:2775})`

### `BindAuthenticator.java`
Flow trên `bind_transmitter` / `bind_receiver` / `bind_transceiver`:
1. Lookup `PartnerSmppAccount` theo `system_id` → reject ESME_RBINDFAIL nếu không có
2. Check status ACTIVE → reject nếu không
3. Verify password (BCrypt). **Cache** verify thành công vào Redis `smpp:bindok:{systemId}:{sha256(password)}` TTL 300s để bind lại nhanh
4. IP whitelist check: JSONB array CIDR (IPv4/IPv6 qua `InetAddress`). Empty/null = allow all → reject ESME_RBINDFAIL nếu không match
5. Max binds: `SessionRegistry.countActive(systemId)` < `maxBinds` → reject ESME_RTHROTTLED nếu vượt
6. Trả `PartnerSmppAccount` (link session với partnerId)

Custom exception: `BindRejected(int smppErrorCode, String message)`.

### `SessionRegistry.java`
In-memory (không persist):
- `ConcurrentHashMap<String, Set<SMPPServerSession>> bySystemId` — count active binds
- `ConcurrentHashMap<String, SessionInfo> infos` — metadata (sessionId, systemId, bindType, remoteIp, connectedAt)
- `ConcurrentHashMap<String, Long> partnerIdBySession` — reverse lookup

API:
- `add(session, systemId, bindType, remoteIp, partnerId)`
- `remove(session)`
- `countActive(systemId)`
- `listAll()` → `List<SessionInfo>`
- `findById(sessionId)` → `Optional<SMPPServerSession>` (cho admin kick)
- `getPartnerId(sessionId)` → `Optional<Long>`

### Submit_sm handling
`MessageReceiverListener` impl:
1. Extract `source_addr`, `dest_addr`, `short_message` (bytes), `data_coding`
2. Map data_coding → `MessageEncoding`:
   - `0x00` → GSM7 (decode ISO-8859-1)
   - `0x08` → UCS2 (UTF-16BE)
   - `0x03` → LATIN1
3. Tạo `Message` (state=RECEIVED, inbound_via=SMPP, partnerId từ SessionRegistry)
4. Persist → publish `InboundMessageEvent` lên `sms.inbound` exchange
5. Trả `submit_sm_resp` với `message_id` = `Message.id` UUID dạng String

---

## 8. Worker — 5 luồng dispatch

`worker/.../`:

### Luồng 1 — SMS HTTP dispatch
**Class chính**: `SmsDispatcherService` + 6 caller trong `worker/http/`

| Provider code | Class | Đặc điểm |
|---|---|---|
| `SPEEDSMS` | `SpeedSmsCaller` | API key auth, JSON body |
| `ESMS` | `ESmsCaller` | API key + secret key, JSON |
| `VIETGUYS` | `VietguysCaller` | Auto-convert E.164 `84...` → local `0...` |
| `ABENLA` | `AbenlaCaller` | Form-encoded |
| `INFOBIP` | `InfobipCaller` | Bearer token, JSON |
| `CUSTOM` | `CustomHttpSmsCaller` | Template substitution `${source_addr/dest_addr/content/message_id}` + JSONPath response parse |

Output: `DispatchResult(success, providerMessageId, error)`.

### Luồng 2 — SMPP outbound tới telco
**Classes** trong `worker/telco/`:

- `TelcoSmppSessionPool`:
  - On `ApplicationReadyEvent`: load tất cả `Channel` ACTIVE type=TELCO_SMPP → `SMPPSession.bind(BIND_TRX)` mỗi channel
  - `enquire_link` keep-alive
  - Auto-reconnect qua `SessionStateListener` + `ScheduledExecutorService`
  - `getSession(channelId) → Optional<SMPPSession>`

- `TelcoSmppDispatcher`:
  - `submitShortMessage(...)` với encoding map:
    - GSM7: `Alphabet.ALPHA_DEFAULT`, ISO-8859-1 bytes, dataCoding `0x00`
    - UCS2: `Alphabet.ALPHA_UCS2`, UTF-16BE bytes, dataCoding `0x08`
  - TON/NPI từ `channel.config` (mặc định src=ALPHANUMERIC, dst=INTERNATIONAL/ISDN)
  - `RegisteredDelivery(SUCCESS_FAILURE)` để request DLR
  - Trả `SubmitSmResult.getMessageId()` → `SmsSendResult`

- `TelcoDlrProcessor`:
  - `MessageReceiverListener.onAcceptDeliverSm` → parse `DeliveryReceipt` (jSMPP) + extract `err:` field
  - `@Transactional`: save `Dlr` + update `Message.state` + publish `DlrEvent` (routing key `dlr.{partnerId}`)

### Luồng 3 — FreeSWITCH ESL Voice OTP
**Classes** trong `worker/esl/` (lib `link.thingscloud:freeswitch-esl:2.2.0`):

- `EslConnectionPool`:
  - 1 `InboundClient` (singleton) load `ServerOption` per channel ACTIVE FREESWITCH_ESL
  - Subscribe `CHANNEL_HANGUP_COMPLETE` global; listener route theo addr→channelId

- `FreeSwitchEslDispatcher`:
  - Build originate command: `{origination_caller_id_name=...,originate_timeout=N}sofia/gateway/<gw>/<dest> &playback(<wav>)`
  - `client.sendSyncApiCommand(addr, "originate", args)` → parse `+OK <uuid>` / `-ERR <reason>`
  - **Pre-register UUID** vào `EslDlrProcessor` trước khi gọi để tránh race với hangup event

- `EslDlrProcessor`:
  - `ConcurrentHashMap<UUID, Pending(messageId, channelId)>` với TTL cleanup
  - On hangup: match UUID → ghi `Dlr` (source=FREESWITCH_ESL, raw_payload chứa headers) + update `Message.state` (DELIVERED nếu NORMAL_CLEARING, FAILED ngược lại)
  - **Không** publish AMQP — voice OTP không có partner DLR webhook

`VoiceOtpDispatcherService` branch theo `channel.type`:
- `FREESWITCH_ESL` → `eslDispatcher.dispatch(channel, destAddr, content, messageId)`

### Luồng 4 — Rate billing
**Class**: `core/service/PartnerBalanceService`

Sau dispatch success ở `InboundMessageConsumer.handleSms()` / `handleVoiceOtp()`:
1. Resolve carrier từ destAddr (`CarrierResolver`)
2. `RateResolver.resolvePartnerRate(partnerId, deliveryType, carrier, msisdnPrefix)` — fallback carrier → prefix → wildcard `''`
3. Atomic deduct: `PartnerRepository.deductBalance(partnerId, amount)`:
   ```sql
   UPDATE partner SET balance = balance - :amount
   WHERE id = :id AND balance >= :amount
   ```
   Affected rows = 1 → success, 0 → insufficient (chỉ log warn, không throw, không reject — pre-paid enforcement là Phase 5+)
4. Không cần `@Version` trên Partner nhờ atomic SQL.

### Luồng 5 — Route cache Redis
**Class**: `worker/RouteResolver`

- Cache key: `route:partner:{partnerId}:{destAddr}`, TTL 60s
- Cache value: `Map<String,Object>` chứa `{id, code, type, deliveryType, status, configJson}` (JsonNode → String để serialize qua Lettuce)
- Cache miss → DB resolve (carrier-first → prefix-fallback) → write cache
- Cache hit → reconstruct transient `Channel` (reflection set `id` field do entity không có setter; setter thường cho code/type/deliveryType/status/config)
- Redis lỗi → `DataAccessException` log warn, fallback DB silently
- Invalidation:
  - `RouteHandlers.create/update/delete` → xóa `route:partner:{id}:*`
  - `ChannelHandlers.update/delete` → xóa `route:partner:*` (channel ảnh hưởng cached entry mọi partner)
- Dùng `redisTemplate.keys()` O(N) — chấp nhận do cache nhỏ; chuyển SCAN nếu lớn.

### DLR forwarder
`worker/dlr/DlrForwarder` consume `sms.dlr.q` (routing key `dlr.{partnerId}`):
- Lookup `partner.dlr_webhook`:
  - Có URL → HTTP call (method từ webhook config, headers tùy chọn, body chuẩn JSON)
  - Không có → check active SMPP session của partner trong `SessionRegistry` → gửi `deliver_sm` PDU với short_message format chuẩn SMPP 3.4 DLR (`id:... sub:001 dlvrd:001 submit date:... done date:... stat:DELIVRD err:000 text:...`)

---

## 9. Authentication & security

### Tổng kết các phương thức

| Endpoint group | Method | Mechanism | Class |
|---|---|---|---|
| `/api/v1/*` | HMAC SHA-256 + replay protection | `X-Api-Key` + `X-Timestamp` + `X-Signature` | `ApiKeyHmacAuthHandler` |
| `/api/admin/*` (trừ login/refresh) | JWT HS256 + Redis blacklist | `Authorization: Bearer <token>` | `JwtAuthHandler` |
| `/api/portal/*` | JWT + role=PARTNER + IDOR | Bearer | `JwtAuthHandler` (cùng class, role check trong handler) |
| `/api/internal/*` | Shared secret | `X-Internal-Secret: ${app.internal.secret}` | InternalRouterFactory inline check |
| SMPP bind | system_id + bcrypt password + IP whitelist | jSMPP PDU | `BindAuthenticator` |

### Crypto utilities (`core/security/`)

- **`PasswordHasher`** — Spring `BCryptPasswordEncoder(10)`. Methods: `hash(String)`, `matches(String, String)`. Dùng cho `admin_user.password_hash` + `partner_smpp_account.password_hash`.

- **`SecretCipher`** — AES/GCM/NoPadding 256-bit. Key: SHA-256 của `${app.secret.key}`. Nonce: 12 bytes random/encryption (SecureRandom). Output `record Encrypted(byte[] ciphertext, byte[] nonce)`. Dùng cho `partner_api_key.secret_encrypted`. Lý do không dùng bcrypt: cần plaintext để verify HMAC.

- **`HmacSigner`** — HmacSHA256. Canonical: `{METHOD}\n{PATH}\n{BODY_HEX}\n{TIMESTAMP}` (newline-delimited). Verify constant-time.

### JWT token lifecycle

1. **Login**: `POST /api/admin/auth/login` body `{username, password}` →
   - Verify bcrypt → generate access + refresh token (UUID jti chung, type khác nhau)
   - Update `admin_user.last_login_at`
   - Trả `{token, refresh_token, expires_in}`
2. **Refresh**: `POST /api/admin/auth/refresh` body `{refresh_token}` →
   - Verify refresh token → reissue access token cùng jti
3. **Logout**: `POST /api/admin/auth/logout` (Bearer) →
   - Lưu jti vào Redis `jwt:bl:{jti}` TTL = remaining exp
4. **Verify** (mỗi request): JwtAuthHandler check signature + blacklist + parse claims

---

## 10. AMQP topology

`core/config/AmqpConfig.java`:

```
Exchange: sms.inbound  (Topic, durable)
  └─ Queue: sms.inbound.q  (durable)
      └─ Binding: routing key = #
          └─ Listener: InboundMessageConsumer.consume(InboundMessageEvent)

Exchange: sms.dlr  (Topic, durable)
  └─ Queue: sms.dlr.q  (durable)
      └─ Binding: routing key = #
          └─ Listener: DlrForwarder.consume(DlrEvent)
```

Listener config (`worker/application.yml`):
```yaml
spring.rabbitmq.listener.simple:
  concurrency: ${WORKER_CONCURRENCY:4}
  max-concurrency: ${WORKER_MAX_CONCURRENCY:16}
  prefetch: ${WORKER_PREFETCH:8}
  acknowledge-mode: AUTO
```

Routing keys nội bộ: `inbound.sms.{partnerId}`, `inbound.voice.{partnerId}`, `dlr.{partnerId}` (sub-routing để dễ debug, hiện bind `#` nên không filter — sẽ refine ở phase sau).

DTO event ở `core/messaging/`:
- `InboundMessageEvent(messageId: UUID, partnerId: Long, destAddr: String, sourceAddr: String, content: String, encoding: String, inboundVia: InboundVia)`
- `DlrEvent(messageId: UUID, partnerId: Long, telcoMessageId: String, state: DlrState, errorCode: String?, rawPayload: JsonNode)`

Chưa có DLQ (dead-letter queue) — sẽ thêm ở Phase 5+ khi cần retry bền vững.

---

## 11. Configuration & environment

### Profile

`SPRING_PROFILES_ACTIVE` (default `dev`). File:
- `smpp-server/src/main/resources/application.yml` (shared)
- `smpp-server/src/main/resources/application-dev.yml` (override log level, etc.)
- `worker/src/main/resources/application.yml`

### Env vars (mặc định trong YAML)

| Group | Var | Default | Ghi chú |
|---|---|---|---|
| Postgres | `DB_HOST` | localhost | |
|  | `DB_PORT` | 5432 | |
|  | `DB_NAME` | smpp_db | |
|  | `DB_USER` | smpp_user | |
|  | `DB_PASSWORD` | smpp_pass | **PHẢI override prod** |
|  | `DB_POOL_SIZE` | 10 (smpp-server), 5 (worker) | HikariCP |
|  | `DB_CONN_TIMEOUT` | 2000 ms | |
| Redis | `REDIS_HOST` | localhost | |
|  | `REDIS_PORT` | 6379 | |
|  | `REDIS_PASSWORD` | (empty) | |
|  | `REDIS_TIMEOUT` | 2s | |
| RabbitMQ | `RABBITMQ_HOST` | localhost | |
|  | `RABBITMQ_PORT` | 5672 | |
|  | `RABBITMQ_USER` | smpp_admin | |
|  | `RABBITMQ_PASSWORD` | smpp_pass | **override prod** |
|  | `RABBITMQ_VHOST` | / | |
| HTTP | `HTTP_PORT` | 8080 | Vert.x bind |
| SMPP | `SMPP_PORT` | 2775 | jSMPP listener |
|  | `SMPP_ENQUIRE_LINK_MS` | 30000 | |
|  | `SMPP_EXECUTOR_CORE` | 32 | |
|  | `SMPP_EXECUTOR_MAX` | 128 | |
|  | `SMPP_EXECUTOR_QUEUE` | 256 | |
| Auth | `APP_JWT_SECRET` | `dev-only-not-for-prod-change-me-min-32-bytes` | **PHẢI override**, ≥32 bytes |
|  | `APP_SECRET_KEY` | `dev-only-aes-key-32-bytes-XXXXXX!` | **PHẢI override**, hashed SHA-256 → 32 bytes |
|  | `APP_INTERNAL_SECRET` | `dev-internal-secret-change-me` | Header /api/internal/* |
|  | `HMAC_TIMESTAMP_SKEW_SECONDS` | 300 | |
|  | `JWT_ACCESS_TTL` | 3600s | |
|  | `JWT_REFRESH_TTL` | 2592000s (30d) | |
| DLR | `DLR_WEBHOOK_TIMEOUT_MS` | 5000 | |
| CORS | `APP_CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | comma-separated |
| Worker | `WORKER_CONCURRENCY` | 4 | |
|  | `WORKER_MAX_CONCURRENCY` | 16 | |
|  | `WORKER_PREFETCH` | 8 | |

### JPA flags
- `spring.jpa.hibernate.ddl-auto: none` — schema do Flyway
- `spring.jpa.open-in-view: false` — tránh N+1 lazy fetch
- `spring.datasource.hikari.allow-pool-suspension: false`
- `spring.main.lazy-initialization: true` — start được khi infra chưa sẵn (fail-fast per module)

### Postgres URL phải có `?stringtype=unspecified`

Lý do: JSONB columns cần Jackson cast. Cấu hình ở `application.yml`:
```yaml
spring.datasource.url: jdbc:postgresql://${DB_HOST}:${DB_PORT}/${DB_NAME}?stringtype=unspecified
```

Đây là quirk đã fix ở commit `a02973e` (xem git log).

---

## 12. Build, run, deploy

### Local development

Yêu cầu: JDK 21 (Temurin), Docker (cho infra), Maven 3.9+ (`./mvnw` đi kèm repo).

```bash
# 1. Hạ tầng (chạy 1 lần, đã có nếu theo infras.md)
docker network create infra-net
cd infra/  # path hạ tầng riêng
docker compose up -d  # postgres + redis + rabbitmq

# 2. Build
cd backend/
./mvnw -B clean package -DskipTests
# Sản phẩm: smpp-server/target/smpp-server-0.1.0-SNAPSHOT.jar
#           worker/target/worker-0.1.0-SNAPSHOT.jar

# 3. Run smpp-server (terminal 1)
JAVA_HOME="C:/Program Files/Eclipse Adoptium/jdk-21.0.10.7-hotspot" \
java -jar smpp-server/target/smpp-server-0.1.0-SNAPSHOT.jar
# hoặc: ./mvnw -pl smpp-server -am spring-boot:run

# 4. Run worker (terminal 2)
java -jar worker/target/worker-0.1.0-SNAPSHOT.jar
# hoặc: ./mvnw -pl worker -am spring-boot:run

# 5. Health check
curl -fsS http://localhost:8080/healthz
# → {"db":"UP","redis":"UP","rabbit":"UP"}

# 6. Login admin
curl -s -X POST http://localhost:8080/api/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@123456"}' | jq
```

### Maven tips
```bash
# Build 1 module + dependencies
./mvnw -B -pl smpp-server -am package

# Skip tests
./mvnw -DskipTests package

# Dependency tree
./mvnw dependency:tree -pl core
```

### Docker

```bash
# Build image
docker build -f smpp-server/Dockerfile -t smpp-server:dev .

# Compose (đã có docker-compose.yml ở backend/)
docker compose up -d
docker compose logs -f smpp-server
docker compose ps
docker compose down  # KHÔNG -v (giữ volume infra-net)
```

### Production deploy (server `116.118.2.74`)

Path: `~/apps/smpp-app/` (chưa deploy ở phase hiện tại — Phase 10).

Constraints (xem `.claude/rules/server-safety.md`):
- KHÔNG `docker compose down -v`
- KHÔNG đụng `~/apps/infrastructure/`
- KHÔNG mở port public ngoài 80, 443, 2775
- KHÔNG expose `/actuator/*` qua Nginx public
- KHÔNG SSH chạy lệnh ghi/restart nếu user chưa yêu cầu rõ

---

## 13. Testing

Test framework: JUnit 5 + Spring Test + Mockito + AssertJ (`spring-boot-starter-test`).

| Module | Test có sẵn |
|---|---|
| `core` | `HmacSignerTest`, `PasswordHasherTest`, `SecretCipherTest` |
| `smpp-server` | (chưa có integration test — sẽ thêm Phase 5+) |
| `worker` | (chưa có) |

**Kế hoạch Phase 5+**:
- vertx-junit5 cho HTTP endpoint test
- Testcontainers cho Postgres/Redis/RabbitMQ integration test
- KHÔNG dùng MockMvc (xem `.claude/rules/vertx-rest.md`)

Lệnh:
```bash
./mvnw -pl core test
./mvnw test  # tất cả module
```

---

## 14. Known limitations & next phases

### Đã hoàn tất (phase 2–4 + 5 luồng worker, snapshot 2026-04-28 — xem `smpp-plan.md`)
- T01–T26 admin auth + CRUD + SMPP listener + partner API + DLR ingress + 5 luồng worker
- Provider/Pricing addon (carrier routing + rate tables)

### Đang stub (cần hoàn thiện ở phase sau)
- `POST /api/admin/channels/:id/test-ping` — trả message hardcoded "not yet implemented in Phase 2" cho HTTP_THIRD_PARTY, "not available for X" cho TELCO_SMPP/FREESWITCH_ESL. Phase 3+ sẽ dùng thật.
- Pre-paid balance enforcement: hiện chỉ log warn nếu insufficient, không reject. Phase 5+ sẽ check balance **trước** dispatch.

### Chưa có endpoint (gap với UI có thể request sau)
- `PUT /api/admin/partners/:partnerId/smpp-accounts/:id` — sửa max_binds, ip_whitelist (FE phải xóa + tạo mới)
- `POST /api/admin/partners/:partnerId/topup` — top-up balance partner (admin chỉ thấy balance, không adjust)
- `POST /api/admin/messages/:id/retry` — không retry message thủ công
- Bulk operations cho `/api/admin/messages` (export, bulk re-route)

### Chưa có DLQ
AMQP topology không có dead-letter — nếu consumer fail, message bị `nack` về queue, retry vô hạn. Phase 5+ thêm DLQ + max retry.

### Chưa có observability
- Chưa Prometheus/Grafana — chỉ có Spring Actuator + log file (Phase 1 plan, sẽ thêm Phase 6+)
- Tracing chưa có (sẽ dùng OpenTelemetry sau)

### Đường tiếp theo
Tham chiếu `gateway/docs/roadmap.md` cho phase 5–10 (auth advanced, observability, multi-region…). Mọi quyết định kiến trúc mới ⇒ thêm ADR vào `gateway/docs/decisions.md` qua skill `adr-author`.

---

## Quick navigation

- Tài liệu chi tiết: `gateway/docs/architecture.md`, `backend.md`, `data-model.md`, `api.md`, `smpp-protocol.md`, `routing.md`, `dispatchers.md`, `dlr-flow.md`
- Tiến độ + resume: `gateway/smpp-plan.md`
- Hạ tầng: `gateway/docs/infras.md` (KHÔNG sửa)
- Decision log: `gateway/docs/decisions.md`
- Phase plan: `gateway/docs/roadmap.md`
- Frontend: `gateway/docs/client.md`
- Rules cho Claude: `.claude/rules/*.md` (vertx-rest, code-language, server-safety, phase-discipline)
- Subagents: `.claude/agents/*.md` (smpp-protocol-expert, vertx-rest-builder, flyway-migration-author)
