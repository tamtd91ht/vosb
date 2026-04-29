# VOSB SMPP Gateway — Tài liệu kỹ thuật tổng hợp

> **Phiên bản**: 0.1.0 — đã hoàn thành Phase 1–7 (BE) + Phase 8/9 UI (chờ smoke test runtime)
> **Cập nhật**: 2026-04-28
> **Phạm vi**: Toàn bộ luồng nghiệp vụ + API checklist + entity model + topology AMQP + cấu hình hạ tầng

---

## Mục lục

1. [Tổng quan dự án](#1-tổng-quan-dự-án)
2. [Stack công nghệ](#2-stack-công-nghệ)
3. [Sơ đồ kiến trúc](#3-sơ-đồ-kiến-trúc)
4. [Các luồng nghiệp vụ chính](#4-các-luồng-nghiệp-vụ-chính)
   - [4.1 Inbound A — Partner gửi qua HTTP](#41-inbound-a--partner-gửi-qua-http)
   - [4.2 Inbound B — Partner gửi qua SMPP](#42-inbound-b--partner-gửi-qua-smpp)
   - [4.3 Luồng 1 — Outbound SMS qua HTTP 3rd-party](#43-luồng-1--outbound-sms-qua-http-3rd-party)
   - [4.4 Luồng 2 — Outbound SMS qua SMPP tới telco](#44-luồng-2--outbound-sms-qua-smpp-tới-telco)
   - [4.5 Luồng 3 — Voice OTP qua FreeSWITCH ESL](#45-luồng-3--voice-otp-qua-freeswitch-esl)
   - [4.6 Luồng 4 — Rate billing](#46-luồng-4--rate-billing)
   - [4.7 Luồng 5 — Route cache Redis](#47-luồng-5--route-cache-redis)
   - [4.8 DLR ingress + forward về partner](#48-dlr-ingress--forward-về-partner)
5. [Domain model](#5-domain-model)
6. [AMQP topology](#6-amqp-topology)
7. [Module / class map](#7-module--class-map)
8. [API checklist đầy đủ](#8-api-checklist-đầy-đủ)
9. [Bảo mật + auth](#9-bảo-mật--auth)
10. [Frontend layout](#10-frontend-layout)
11. [Hạ tầng + deployment](#11-hạ-tầng--deployment)
12. [Phụ lục — quirks + ADR đã chốt](#12-phụ-lục--quirks--adr-đã-chốt)

---

## 1. Tổng quan dự án

**VOSB SMPP Gateway** là **aggregator gateway** trung gian giữa các đối tác (`partner`) cần gửi tin nhắn (SMS / Voice OTP) và các nhà cung cấp đầu cuối (telco SMSC qua SMPP, HTTP 3rd-party, FreeSWITCH cho voice OTP nội bộ).

**Vai trò chính:**

- **Ingress** đa giao thức: nhận tin từ partner qua SMPP (port 2775) hoặc HTTP REST API.
- **Routing** theo (partner, carrier/prefix) với fallback chain.
- **Dispatch** ra:
  - HTTP REST tới các nhà cung cấp SMS (SpeedSMS, eSMS, Vietguys, Abenla, Infobip, Custom).
  - SMPP outbound tới telco SMSC.
  - FreeSWITCH ESL TCP cho voice OTP nội bộ.
- **DLR** ingress + forward về partner (SMPP `deliver_sm` hoặc HTTP webhook).
- **Billing** prepaid: mỗi tin gửi thành công trừ `partner.balance` theo `partner_rate`.
- **Admin UI / Partner Portal** quản trị + self-service.

**Repo**:

```
tkc-02/
├── smpp/
│   ├── backend/        Maven multi-module (core, smpp-server, worker)
│   ├── frontend/       Next.js 15 App Router (admin + portal cùng app)
│   ├── nginx/          Vhost + TLS config (chưa code, Phase 10)
│   └── docs/           Tài liệu kỹ thuật chi tiết
├── readme/             Bản tiếng Việt có chú thích (tham khảo)
└── .ssh/               SSH key tới server prod (KHÔNG commit)
```

---

## 2. Stack công nghệ

| Lớp | Công nghệ | Vai trò |
|---|---|---|
| Backend runtime | Java 21 + Spring Boot 3.3 | Bootstrap, DI, lifecycle, config — **KHÔNG dùng Spring MVC** (xem ADR-010) |
| Backend HTTP | **Vert.x Web 4.5** | Toàn bộ HTTP / REST router + handler |
| Backend SMPP | jSMPP 3.0.0 | SMPP server (inbound bind) + SMPP client (outbound tới telco) |
| Backend ESL | `link.thingscloud:freeswitch-esl:2.2.0` | FreeSWITCH ESL inbound client (voice OTP) |
| Persistence | Postgres 16 + Spring Data JPA + Flyway | Schema + migrations |
| Cache / lock | Redis 7 (Lettuce) | JWT blacklist, HMAC replay protection, route cache, bind auth cache |
| Message broker | RabbitMQ 3.13 + Spring AMQP | `sms.inbound.q`, `sms.dlr.q` |
| Frontend | Next.js 16 (App Router) + TypeScript | Admin UI + Partner portal cùng app |
| Frontend auth | NextAuth v5 (Credentials) | JWT cookie session, role guard 2-lớp (proxy + layout) |
| Frontend UI | Tailwind 4 + shadcn/ui + Radix + Recharts | Component library |
| Frontend data | TanStack Query + Zustand | Server state + UI state |
| Containerization | Docker Compose (`infra-net`) | Postgres / Redis / RabbitMQ + smpp-server container |
| Reverse proxy | Nginx (host, không docker) | TLS termination, vhost (Phase 10) |
| Build | Maven Wrapper (`mvnw`) + pnpm | BE + FE |

---

## 3. Sơ đồ kiến trúc

```
                            ┌──────────────────────────────────────────┐
                            │          PARTNER (khách hàng)             │
                            │  - SMPP client (BIND_TRX/TX/RX)           │
                            │  - HTTP REST client (X-Api-Key + HMAC)    │
                            └────────────┬───────────────┬─────────────┘
                                  port 2775│             │ HTTPS 443
                                           │             │
                                           ▼             ▼
                            ┌──────────────────────────────────────────┐
                            │           Nginx (host server)             │
                            │  TLS, rate-limit, reverse proxy           │
                            └────────────┬───────────────┬─────────────┘
                                         │               │
                         ┌───────────────┴───────┐   ┌──┴──────────────┐
                         │   smpp-server (8080)  │   │   frontend (3000)│
                         │   ┌─────────────────┐ │   │   Next.js 16     │
                         │   │ Vert.x routers  │ │   │   /admin /portal │
                         │   │ /api/v1/*       │ │   └──────────────────┘
                         │   │ /api/admin/*    │ │
                         │   │ /api/portal/*   │ │
                         │   │ /api/internal/* │ │
                         │   └────────┬────────┘ │
                         │   ┌────────┴────────┐ │
                         │   │ jSMPP server     │ │ port 2775 (public)
                         │   │ (bind/auth/PDU)  │ │
                         │   └────────┬────────┘ │
                         └────────────┼──────────┘
                                      │ enqueue InboundMessageEvent
                                      ▼
              ┌──────────────────── RabbitMQ (sms.inbound.q) ────────────────────┐
              │                                                                    │
              │     ┌────────────────────────────────────────────────────┐        │
              │     │              worker (Spring AMQP listener)          │        │
              │     │  InboundMessageConsumer                              │        │
              │     │      │                                               │        │
              │     │      ▼                                               │        │
              │     │  RouteResolver (Redis cache 60s ─→ Postgres)         │        │
              │     │      │                                               │        │
              │     │      ▼                                               │        │
              │     │  ┌─────────────┬──────────────┬─────────────────┐   │        │
              │     │  │  SMS HTTP   │  TELCO_SMPP  │  FreeSWITCH ESL │   │        │
              │     │  │ (Luồng 1)   │  (Luồng 2)   │   (Luồng 3)     │   │        │
              │     │  └──────┬──────┴───────┬──────┴────────┬────────┘   │        │
              │     │         │              │               │            │        │
              │     │         ▼              ▼               ▼            │        │
              │     │   3rd-party API   Telco SMSC      FreeSWITCH        │        │
              │     │   (HTTPS)         (SMPP TCP)      (ESL TCP 8021)    │        │
              │     │                                                       │        │
              │     │  Sau dispatch success:                                │        │
              │     │    PartnerBalanceService.deductForMessage (Luồng 4)   │        │
              │     └────────────────────────────────────────────────────┘        │
              │                                                                    │
              │     DLR async loop:                                                │
              │     TelcoDlrProcessor / EslDlrProcessor / DlrIngressHandler        │
              │       → Dlr table + Message.state                                  │
              │       → publish sms.dlr.q                                          │
              │                                                                    │
              │     ┌────────────────────────────────────────────────────┐        │
              │     │  DlrForwarder (smpp-server, AMQP listener)          │        │
              │     │      │                                              │        │
              │     │      ├─→ SMPP deliver_sm (qua active SessionRegistry)│       │
              │     │      └─→ HTTP webhook POST partner.dlrWebhook.url    │       │
              │     └────────────────────────────────────────────────────┘        │
              └────────────────────────────────────────────────────────────────────┘

   Persistence:  Postgres 16 (8 bảng + carrier_prefix + 2 rate tables)
   Cache:        Redis 7 (JWT blacklist, HMAC replay, route cache, bind cache)
```

---

## 4. Các luồng nghiệp vụ chính

### 4.1 Inbound A — Partner gửi qua HTTP

**Endpoint**: `POST /api/v1/messages` (auth: `X-Api-Key` + `X-Timestamp` + `X-Signature` HMAC SHA-256).

**Flow**:

1. **TLS** terminate ở Nginx → forward `127.0.0.1:8080`.
2. `PartnerRouterFactory` mount sub-router `/api/v1/*` với `BodyHandler` global + `ApiKeyHmacAuthHandler` cho route `/messages`.
3. `ApiKeyHmacAuthHandler`:
   - Đọc 3 header (key, timestamp, signature). Thiếu → 401.
   - Validate timestamp ±300s (`app.hmac.timestamp-skew-seconds`).
   - Lookup `partner_api_key` trong DB theo `keyId`, status phải `ACTIVE`.
   - Decrypt `secret_encrypted` (AES-GCM 256, key từ env `APP_SECRET_KEY`) → secret raw.
   - Tính `HMAC-SHA256(secret, "{method}:{path}:{body_sha256_hex}:{timestamp}")`, so sánh constant-time.
   - **Replay check**: Redis `SET hmac:replay:{signature} 1 EX 600 NX`. Nếu đã tồn tại → 401.
   - Đặt `PartnerContext(partnerId, keyId)` vào `ctx.data()`.
4. `PartnerMessageHandlers.send`:
   - Parse body `SendRequest{ source_addr, dest_addr, content, encoding?, client_ref? }`.
   - Validate dest E.164 (`\d{7,15}` sau normalize).
   - Insert `Message` (state=`RECEIVED`, partner=ctx.partnerId, inboundVia=`HTTP`).
   - Publish `InboundMessageEvent` lên exchange `sms.inbound` (routing key `inbound.<partnerId>`).
   - Trả `202 Accepted` `{ message_id, state: "RECEIVED" }`.

**File chính**:
- `smpp-server/src/main/java/com/smpp/server/auth/ApiKeyHmacAuthHandler.java`
- `smpp-server/src/main/java/com/smpp/server/auth/SecretCipher.java`
- `smpp-server/src/main/java/com/smpp/server/http/partner/PartnerMessageHandlers.java`
- `smpp-server/src/main/java/com/smpp/server/http/partner/PartnerRouterFactory.java`

---

### 4.2 Inbound B — Partner gửi qua SMPP

**Port**: `2775` (TCP, public qua firewall UFW).

**Flow**:

1. Partner SMPP client mở TCP → server jSMPP `SmppAcceptLoop` accept.
2. Partner gửi `bind_transceiver` / `_transmitter` / `_receiver` PDU với `system_id` + `password` + (optional) IP.
3. `BindAuthenticator`:
   - Lookup `partner_smpp_account` theo `system_id`, status `ACTIVE`.
   - Verify password bcrypt.
   - Validate IP whitelist (`ip_whitelist` JSONB, hỗ trợ CIDR).
   - Enforce `max_binds` per account (đếm session đang mở qua `SessionRegistry`).
   - Cache success Redis 5 phút (`smpp:bind:{system_id}:{ip}`).
   - Bind fail → trả `bind_*_resp` với `command_status` non-zero (vd `0x0E ESME_RINVPASWD`).
4. `MessageReceiverListenerImpl.onAcceptSubmitSm`:
   - Lấy `source_addr` / `destination_addr` / `short_message` / `data_coding`.
   - Decode bytes → String (GSM7 nếu DC=0x00, UCS2 nếu 0x08).
   - Insert `Message` (state=`RECEIVED`, inboundVia=`SMPP`, encoding mapped).
   - Publish `InboundMessageEvent` lên `sms.inbound`.
   - Trả `submit_sm_resp` với `message_id` = UUID Message vừa tạo.
5. `SessionRegistry` track session — sau này DLR forwarder dùng để gửi `deliver_sm` ngược lại.

Các PDU không hỗ trợ (`submit_multi`, `query_sm`, `replace_sm`, `cancel_sm`, `data_sm`, ...) trả `ESME_RINVCMDID = 0x03`.

**File chính**:
- `smpp-server/src/main/java/com/smpp/server/smpp/SmppServerConfig.java`
- `smpp-server/src/main/java/com/smpp/server/smpp/SmppAcceptLoop.java`
- `smpp-server/src/main/java/com/smpp/server/smpp/BindAuthenticator.java`
- `smpp-server/src/main/java/com/smpp/server/smpp/MessageReceiverListenerImpl.java`
- `smpp-server/src/main/java/com/smpp/server/smpp/SessionRegistry.java`

---

### 4.3 Luồng 1 — Outbound SMS qua HTTP 3rd-party

**Trigger**: `InboundMessageConsumer` consume `sms.inbound.q` → resolve route → channel.type = `HTTP_THIRD_PARTY`.

**Flow** trong `worker`:

1. `RouteResolver.resolve(partnerId, destAddr)`:
   - **Phase 1 — Carrier-based**: `CarrierResolver` map prefix → carrier (in-memory, sorted DESC by length); tìm `route` matching `(partnerId, carrier)`.
   - **Phase 2 — Prefix fallback**: nếu phase 1 miss, lấy tất cả route `carrier IS NULL` của partner sort theo `(priority DESC, msisdn_prefix DESC)`, chọn longest matching prefix (hoặc empty `""` wildcard).
   - **Cache**: Redis `route:partner:<id>:<dest>` TTL 60s — đọc trước, miss thì DB rồi populate.
2. `SmsDispatcherService.dispatch(channel, source, dest, content, messageId)`:
   - `channel.type == TELCO_SMPP` → đi Luồng 2 (mục 4.4).
   - Còn lại đọc `config.provider_code` và switch:

| Provider code | Class | Endpoint | Auth |
|---|---|---|---|
| `SPEEDSMS` | `SpeedSmsCaller` | `https://api.speedsms.vn/index.php/sms/send` | Basic `access_token:x` |
| `ESMS` | `ESmsCaller` | `https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/` | API key trong body |
| `VIETGUYS` | `VietguysCaller` | `http://cloudsms.vietguys.biz:8088/api/` | username + password trong body, **tự normalize 84xxx → 0xxx** |
| `ABENLA` | `AbenlaCaller` | `https://abenla.com/api/gateway.php` | API key trong body |
| `INFOBIP` | `InfobipCaller` | `{base_url}/sms/2/text/advanced` | header `Authorization: App {api_key}` |
| `CUSTOM` | `CustomHttpSmsCaller` | configurable | Bearer / Basic / HMAC tuỳ config |

3. `CustomHttpSmsCaller` đặc biệt: hỗ trợ template substitution `${source_addr}` / `${dest_addr}` / `${content}` / `${message_id}` trong body, parse response qua `response_id_path` + `response_status_path` (JSONPath) + `response_status_success_values`.

4. **Trả về** `SmsSendResult(success, providerMessageId, error)`:
   - Thành công: `messageRepo.updateStateAndTelcoId(SUBMITTED, null, providerMessageId)` + **Luồng 4 charge balance**.
   - Lỗi: `messageRepo.updateState(FAILED, errorTruncated)`.

**File chính**:
- `worker/src/main/java/com/smpp/worker/SmsDispatcherService.java`
- `worker/src/main/java/com/smpp/worker/InboundMessageConsumer.java`
- `worker/src/main/java/com/smpp/worker/RouteResolver.java`
- `worker/src/main/java/com/smpp/worker/CarrierResolver.java`
- `worker/src/main/java/com/smpp/worker/sms/{SpeedSms,ESms,Vietguys,Abenla,Infobip,CustomHttpSms}Caller.java`

---

### 4.4 Luồng 2 — Outbound SMS qua SMPP tới telco

**Trigger**: `channel.type == TELCO_SMPP`.

**Channel config** (JSONB):
```json
{
  "host": "smsc.telco.vn",
  "port": 2775,
  "system_id": "vosb",
  "password": "secret",
  "system_type": "",
  "encoding": "GSM7",
  "source_ton": 5, "source_npi": 0,
  "dest_ton": 1, "dest_npi": 1,
  "enquire_link_ms": 30000,
  "reconnect_delay_ms": 5000
}
```

**Flow**:

1. `TelcoSmppSessionPool.init()` (chạy trên `ApplicationReadyEvent`):
   - Load `findByTypeAndStatus(TELCO_SMPP, ACTIVE)`.
   - Mỗi channel: `new SMPPSession()` → `connectAndBind(BIND_TRX, system_id, password)` + register `MessageReceiverListener`.
   - Đăng ký `SessionStateListener`: nếu state rời `BOUND_*` → schedule reconnect sau `reconnect_delay_ms`.
2. `TelcoSmppDispatcher.dispatch(channel, src, dest, content)`:
   - Lấy session từ pool theo `channel.id`. Nếu không bound → `(false, null, "No active session")`.
   - Build PDU: `data_coding` theo encoding cfg, bytes ISO_8859_1 (GSM7) hoặc UTF-16BE (UCS2), TON/NPI từ config, `RegisteredDelivery=SUCCESS_FAILURE` để xin DLR.
   - `session.submitShortMessage(...).getMessageId()` → `telcoMsgId`.
   - Trả `SmsSendResult(true, telcoMsgId, null)`.
3. **DLR async** (TelcoDlrListener):
   - Telco trả `deliver_sm` với `esm_class` chứa cờ DLR (`MessageType.SMSC_DEL_RECEIPT.containedIn(byte)`).
   - Parse body theo SMSC standard receipt: `id:X submit date:Y done date:Z stat:W err:NNN`.
   - `getFinalStatus()` → `DELIVRD/UNDELIV/EXPIRED/REJECTD/DELETED` map sang `DlrState`.
4. `TelcoDlrProcessor.process(channelId, telcoMsgId, state, errorCode)`:
   - `messageRepo.findByMessageIdTelco` lookup message.
   - Insert `Dlr` (source=`TELCO_SMPP`, raw `err:` field).
   - Update `Message.state` (DELIVERED nếu DELIVRD, FAILED còn lại).
   - Publish `DlrEvent` lên `sms.dlr` exchange với routing key `dlr.<partnerId>`.

**File chính**:
- `worker/src/main/java/com/smpp/worker/telco/TelcoSmppSessionPool.java`
- `worker/src/main/java/com/smpp/worker/telco/TelcoSmppDispatcher.java`
- `worker/src/main/java/com/smpp/worker/telco/TelcoDlrProcessor.java`

---

### 4.5 Luồng 3 — Voice OTP qua FreeSWITCH ESL

**Trigger**: `channel.type == FREESWITCH_ESL`, delivery_type = `VOICE_OTP`, `provider_code = "FREESWITCH_ESL"`.

**Channel config**:
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

**Flow** (worker):

1. `EslConnectionPool.init()` (trên `ApplicationReadyEvent`):
   - Load `findByTypeAndStatus(FREESWITCH_ESL, ACTIVE)`.
   - Tạo 1 `InboundClient` singleton (thingscloud lib) với `InboundClientOption`.
   - Mỗi channel → 1 `ServerOption(host, port).password(pwd)` → `option.addServerOption(...)`.
   - Subscribe global event `EventNames.CHANNEL_HANGUP_COMPLETE` + register `IEslEventListener`.
   - `client.start()` — library tự handle reconnect.
   - Maintain map `channelId → "host:port"` và `"host:port" → channelId` cho event correlation.
2. `FreeSwitchEslDispatcher.dispatch(channel, dest, content, messageId)`:
   - Build args: `{origination_caller_id_name='X',origination_caller_id_number='Y',originate_timeout=N}sofia/gateway/<gw>/<dest> &playback(<wav>)`.
   - `client.sendSyncApiCommand(addr, "originate", args)` → `EslMessage`.
   - Parse first body line: `+OK <uuid>` hoặc `-ERR <reason>`.
   - Nếu OK: `dlrProcessor.registerPending(uuid, messageId, channelId, timeoutMs)` (TTL = `timeoutMs + 60s`) + trả `(true, uuid, null)`.
3. **Hangup async** (`HangupListener.eventReceived`):
   - Nhận `CHANNEL_HANGUP_COMPLETE` event.
   - Resolve `channelId` từ `addr`.
   - Trích `Unique-ID` + `Hangup-Cause` từ headers.
   - `pending.remove(uuid)` → ra `messageId`.
4. `EslDlrProcessor.process` (`@Transactional`):
   - Map cause → `DlrState`:
     - `NORMAL_CLEARING` → `DELIVERED`.
     - `NO_ANSWER`, `USER_BUSY`, `NO_USER_RESPONSE`, `ALLOTTED_TIMEOUT`, `CALL_REJECTED`, `ORIGINATOR_CANCEL` → `EXPIRED`.
     - Khác → `FAILED`.
   - Insert `Dlr` (source=`FREESWITCH_ESL`, raw_payload = JSON of headers).
   - Update `Message.state` (DELIVERED nếu state=DELIVERED, FAILED còn lại — bảng Message hiện không có EXPIRED).
   - **Không publish AMQP** — voice OTP không có partner DLR webhook.

**Provider voice OTP thay thế**: `2TMOBILE_VOICE` qua `TwoMobileVoiceCaller` (HTTP GET `/voiceapi/call`, parse XML CODE=100 = success). Không có DLR async.

**File chính**:
- `worker/src/main/java/com/smpp/worker/esl/EslConnectionPool.java`
- `worker/src/main/java/com/smpp/worker/esl/FreeSwitchEslDispatcher.java`
- `worker/src/main/java/com/smpp/worker/esl/EslDlrProcessor.java`
- `worker/src/main/java/com/smpp/worker/VoiceOtpDispatcherService.java`
- `worker/src/main/java/com/smpp/worker/TwoMobileVoiceCaller.java`

---

### 4.6 Luồng 4 — Rate billing

**Trigger**: ngay sau khi dispatch (Luồng 1/2/3) trả `success == true`.

**Flow** (`InboundMessageConsumer.chargePartner`):

1. `CarrierResolver.resolve(destAddr)` → `Optional<String>` (vd `"VIETTEL"`).
2. `PartnerBalanceService.deductForMessage(messageId, partnerId, deliveryType, carrier, msisdnPrefix=destAddr)`:
   - `RateResolver.resolvePartnerRate(...)` — 3-level fallback:
     1. Carrier-specific: `partner_rate.carrier = X`.
     2. Prefix-specific: `carrier IS NULL, prefix = msisdnPrefix`.
     3. Wildcard: `carrier IS NULL, prefix = ''`.
   - Filter `effective_from <= today` and `(effective_to IS NULL OR effective_to >= today)`.
   - Empty → log warn, KHÔNG deduct, KHÔNG throw.
3. Có rate → `partnerRepo.deductBalance(id, rate)`:
   ```sql
   UPDATE partner SET balance = balance - :amount
   WHERE id = :id AND balance >= :amount
   ```
   - Atomic ở DB level — không cần `@Version` / optimistic lock.
   - Trả `0` nếu insufficient → log warn, message vẫn `SUBMITTED` (KHÔNG rollback dispatch).
4. Throw exception trong charging KHÔNG ảnh hưởng dispatch — `chargePartner` wrap try/catch.

**Lưu ý phase này (Phase 5+)**:
- Không có cơ chế reject pre-dispatch khi balance âm.
- Chuyển sang strict pre-paid sau khi có monitoring + alert.

**File chính**:
- `core/src/main/java/com/smpp/core/service/PartnerBalanceService.java`
- `core/src/main/java/com/smpp/core/service/RateResolver.java`
- `core/src/main/java/com/smpp/core/repository/PartnerRepository.java#deductBalance`

---

### 4.7 Luồng 5 — Route cache Redis

**Mục tiêu**: giảm tải DB cho `RouteResolver.resolve(partnerId, destAddr)`.

**Cache key & value**:

```
Key:   route:partner:<partnerId>:<destAddr>
Value: Map<String,Object> { id, code, type, deliveryType, status, configJson }
TTL:   60 giây
Serializer: GenericJackson2JsonRedisSerializer (registered ở core RedisConfig)
```

**Flow đọc**:
1. `RouteResolver.resolve` build cache key.
2. `redisTemplate.opsForValue().get(key)` → nếu trả `Map<?,?>` → `toTransientChannel(map)`:
   - Reflection set field `id` (Channel entity không có setter cho ID).
   - Setters cho `code`, `type`, `deliveryType`, `status`.
   - `objectMapper.readTree(configJson)` → JsonNode.
3. Cache miss → `resolveFromDb` → nếu có channel: `redisTemplate.opsForValue().set(key, payload, 60s)`.
4. Redis `DataAccessException` → log warn, fallback DB silently.

**Invalidation**:
- `RouteHandlers.create/update/delete` (smpp-server) → xóa key pattern `route:partner:<id>:*`.
- `ChannelHandlers.update/delete` → xóa **toàn bộ** `route:partner:*` (channel config thay đổi ảnh hưởng cached entry trên mọi partner).
- Dùng `redis.keys(pattern)` + `redis.delete(set)` — `keys()` là O(N), chấp nhận do cache size nhỏ trong giai đoạn này; chuyển sang `SCAN` khi Redis lớn.

**File chính**:
- `worker/src/main/java/com/smpp/worker/RouteResolver.java`
- `smpp-server/src/main/java/com/smpp/server/http/admin/route/RouteHandlers.java`
- `smpp-server/src/main/java/com/smpp/server/http/admin/channel/ChannelHandlers.java`

---

### 4.8 DLR ingress + forward về partner

DLR (Delivery Receipt) đến từ 3 nguồn — đều quy về cùng đích cuối là `Dlr` table + `DlrEvent` AMQP:

| Nguồn | Class xử lý | Source enum |
|---|---|---|
| HTTP webhook (HTTP_THIRD_PARTY) | `DlrIngressHandler` (smpp-server, `POST /api/internal/dlr/{channelId}`) | `HTTP_WEBHOOK` |
| SMPP `deliver_sm` từ telco SMSC | `TelcoSmppSessionPool.TelcoDlrListener` → `TelcoDlrProcessor` (worker) | `TELCO_SMPP` |
| FreeSWITCH `CHANNEL_HANGUP_COMPLETE` | `EslConnectionPool.HangupListener` → `EslDlrProcessor` (worker) | `FREESWITCH_ESL` |

**Common pattern**:

1. Lookup `Message` theo `messageIdTelco` (HTTP/SMPP) hoặc theo `pending uuid` (ESL).
2. `INSERT INTO dlr (...)` với raw payload.
3. `UPDATE message SET state = ..., error_code = ...`.
4. **Voice OTP**: dừng ở đây (không AMQP). **SMS**: publish `DlrEvent` lên `sms.dlr` với routing key `dlr.<partnerId>`.

**DlrForwarder** (smpp-server, AMQP listener trên `sms.dlr.q`):

1. Consume `DlrEvent`.
2. **Ưu tiên SMPP**: `SessionRegistry.findActiveByPartner(partnerId)` → nếu có session BOUND_TRX/BOUND_RX → gửi `deliver_sm` với body chuẩn SMSC receipt:
   ```
   id:<msgId> sub:001 dlvrd:001 submit date:<yymmddhhmm> done date:<yymmddhhmm> stat:DELIVRD err:000 text:
   ```
3. **Fallback HTTP**: nếu không có session SMPP → POST `partner.dlrWebhook.url` JSON `{message_id, state, dest_addr, error_code}`.
4. Retry / dead-letter chính sách: hiện chưa có DLQ — failed forward log error + nuốt (Phase 6+ thêm DLQ).

**DLR ingress webhook auth**: header `X-Internal-Secret` match `app.internal.secret` (env var `INTERNAL_SECRET`). KHÔNG expose `/api/internal/*` qua Nginx public — chỉ allow LAN/internal.

**File chính**:
- `smpp-server/src/main/java/com/smpp/server/http/internal/DlrIngressHandler.java`
- `worker/src/main/java/com/smpp/worker/telco/TelcoDlrProcessor.java`
- `worker/src/main/java/com/smpp/worker/esl/EslDlrProcessor.java`
- `smpp-server/src/main/java/com/smpp/server/outbound/DlrForwarder.java`

---

## 5. Domain model

### 5.1 Bảng Postgres (Flyway V1 + addons)

| Bảng | Cột chính | Vai trò |
|---|---|---|
| `admin_user` | `id, username (UQ), password_hash, role (ADMIN/PARTNER), partner_id (FK), enabled, last_login_at` | User đăng nhập admin/portal |
| `partner` | `id, code (UQ), name, status (ACTIVE/SUSPENDED), dlr_webhook (jsonb), balance (numeric 18,4)` | Đối tác — thực thể billing |
| `partner_smpp_account` | `id, partner_id (FK), system_id (UQ), password_hash, max_binds, ip_whitelist (jsonb), status` | Credential SMPP cho partner bind |
| `partner_api_key` | `id, partner_id (FK), key_id (UQ), secret_encrypted (bytea), nonce (bytea), status, label, last_used_at` | Credential HTTP REST cho partner |
| `partner_rate` | `id, partner_id (FK), delivery_type, prefix, carrier, rate, currency, unit, effective_from/to` | Bảng giá charge partner (revenue side) |
| `channel` | `id, code (UQ), name, type (HTTP_THIRD_PARTY/FREESWITCH_ESL/TELCO_SMPP), config (jsonb), delivery_type, status` | Kênh dispatch outbound |
| `channel_rate` | `id, channel_id (FK), prefix, carrier, rate, currency, unit, effective_from/to` | Cost của VOSB tới provider |
| `route` | `id, partner_id (FK), msisdn_prefix, carrier, channel_id (FK), fallback_channel_id (FK), priority, enabled` | Routing rule |
| `message` | `id (UUID), partner_id (FK), channel_id (FK nullable), source_addr, dest_addr, content, encoding, inbound_via, state, message_id_telco, error_code, version` | Tin nhắn — main entity |
| `dlr` | `id, message_id (FK), state, error_code, raw_payload (jsonb), source, received_at` | DLR event log |
| `carrier_prefix` | `prefix (PK), carrier` | Lookup carrier từ E.164 prefix |

### 5.2 Enum

| Enum | Giá trị |
|---|---|
| `AdminRole` | ADMIN, PARTNER |
| `Carrier` | VIETTEL, MOBIFONE, VINAPHONE, VIETNAMOBILE, GMOBILE, REDDI |
| `ChannelStatus` | ACTIVE, DISABLED |
| `ChannelType` | HTTP_THIRD_PARTY, FREESWITCH_ESL, TELCO_SMPP |
| `DeliveryType` | SMS, VOICE_OTP |
| `DlrSource` | TELCO_SMPP, HTTP_WEBHOOK, FREESWITCH_ESL |
| `DlrState` | DELIVERED, FAILED, EXPIRED, UNKNOWN |
| `InboundVia` | SMPP, HTTP |
| `KeyStatus` | ACTIVE, REVOKED |
| `MessageEncoding` | GSM7, UCS2, LATIN1 |
| `MessageState` | RECEIVED, ROUTED, SUBMITTED, DELIVERED, FAILED |
| `PartnerStatus` | ACTIVE, SUSPENDED |
| `RateUnit` | MESSAGE, SECOND, CALL |
| `SmppAccountStatus` | ACTIVE, DISABLED |

---

## 6. AMQP topology

**Broker**: RabbitMQ 3.13.

| Exchange | Type | Durable | Vai trò |
|---|---|---|---|
| `sms.inbound` | topic | yes | Nhận `InboundMessageEvent` từ smpp-server (HTTP + SMPP ingress) |
| `sms.dlr` | topic | yes | Nhận `DlrEvent` từ worker DLR processors |

| Queue | Bound to | Routing key | Consumer |
|---|---|---|---|
| `sms.inbound.q` | `sms.inbound` | `#` | `InboundMessageConsumer` (worker, concurrency 4–16, prefetch 8) |
| `sms.dlr.q` | `sms.dlr` | `#` | `DlrForwarder` (smpp-server) |

**Event schemas** (record):

```java
record InboundMessageEvent(
    UUID messageId,
    Long partnerId,
    String sourceAddr,
    String destAddr,
    String content,
    String encoding,        // GSM7 | UCS2 | LATIN1
    String inboundVia,      // SMPP | HTTP
    String clientRef        // optional
) {}

record DlrEvent(
    UUID messageId,
    Long partnerId,
    String sourceAddr,
    String destAddr,
    DlrState state,
    String errorCode,       // nullable
    String messageIdTelco
) {}
```

**Routing key** publish:
- Inbound: `inbound.<partnerId>` (queue bind `#` nên match all).
- DLR: `dlr.<partnerId>`.

**Constants file**: `core/src/main/java/com/smpp/core/amqp/AmqpConstants.java`.

---

## 7. Module / class map

```
smpp/backend/
├── core/   (lib chia sẻ)
│   └── src/main/java/com/smpp/core/
│       ├── amqp/
│       │   ├── AmqpConstants.java
│       │   ├── AmqpConfig.java                    (queue/exchange/binding bean)
│       │   ├── InboundMessageEvent.java
│       │   └── DlrEvent.java
│       ├── config/
│       │   ├── DataSourceConfig.java
│       │   ├── RedisConfig.java                   (autoConfig before RedisAutoConfiguration)
│       │   ├── JacksonConfig.java
│       │   └── FlywayConfig.java
│       ├── domain/                                (11 entity + converter + 14 enum)
│       ├── repository/                            (Spring Data JPA)
│       └── service/
│           ├── RateResolver.java
│           └── PartnerBalanceService.java         (Luồng 4)
│
├── smpp-server/   (HTTP REST + SMPP server inbound + DlrForwarder)
│   └── src/main/java/com/smpp/server/
│       ├── ServerApplication.java
│       ├── auth/
│       │   ├── JwtService.java                    (HS256 + Redis blacklist)
│       │   ├── JwtAuthHandler.java                (Vert.x AuthenticationHandler)
│       │   ├── ApiKeyHmacAuthHandler.java         (HMAC SHA-256 + replay)
│       │   └── SecretCipher.java                  (AES-GCM 256)
│       ├── config/
│       │   └── VertxConfig.java                   (Vertx + HttpServer + rootRouter)
│       ├── http/
│       │   ├── partner/                           (/api/v1/*)
│       │   │   ├── PartnerRouterFactory.java
│       │   │   └── PartnerMessageHandlers.java
│       │   ├── admin/                             (/api/admin/*)
│       │   │   ├── AdminRouterFactory.java
│       │   │   ├── auth/AuthHandlers.java
│       │   │   ├── partner/PartnerHandlers.java
│       │   │   ├── partner/SmppAccountHandlers.java
│       │   │   ├── partner/ApiKeyHandlers.java
│       │   │   ├── partner/PartnerRateHandlers.java
│       │   │   ├── carrier/CarrierHandlers.java
│       │   │   ├── channel/ChannelHandlers.java
│       │   │   ├── channel/ChannelRateHandlers.java
│       │   │   ├── route/RouteHandlers.java
│       │   │   ├── message/MessageHandlers.java
│       │   │   ├── session/SessionHandlers.java
│       │   │   ├── stats/StatsHandlers.java
│       │   │   └── user/UserHandlers.java
│       │   ├── portal/                            (/api/portal/*)
│       │   │   ├── PortalRouterFactory.java
│       │   │   ├── OverviewHandlers.java
│       │   │   ├── PortalMessageHandlers.java
│       │   │   ├── PortalApiKeyHandlers.java
│       │   │   ├── PortalSmppHandlers.java
│       │   │   └── WebhookHandlers.java
│       │   ├── internal/                          (/api/internal/*)
│       │   │   ├── InternalRouterFactory.java
│       │   │   └── DlrIngressHandler.java
│       │   ├── health/HealthHandlers.java
│       │   ├── error/ProblemJsonFailureHandler.java
│       │   ├── common/{HandlerUtils,BlockingDispatcher}.java
│       │   └── provider/                          (HTTP provider adapters)
│       │       ├── HttpProviderRegistry.java
│       │       ├── HttpProviderAdapter.java
│       │       └── {SpeedSms,ESms,Vietguys,Abenla,Infobip,CustomHttp,TwoMobileVoice,Stringee}Adapter.java
│       ├── smpp/
│       │   ├── SmppServerConfig.java
│       │   ├── SmppAcceptLoop.java
│       │   ├── BindAuthenticator.java
│       │   ├── MessageReceiverListenerImpl.java
│       │   └── SessionRegistry.java
│       └── outbound/
│           └── DlrForwarder.java
│
└── worker/   (AMQP consumer, dispatchers)
    └── src/main/java/com/smpp/worker/
        ├── WorkerApplication.java
        ├── InboundMessageConsumer.java            (entry point Luồng 1-4)
        ├── RouteResolver.java                     (Luồng 5 cache)
        ├── CarrierResolver.java
        ├── SmsDispatcherService.java              (Luồng 1 + 2 dispatch)
        ├── VoiceOtpDispatcherService.java         (Luồng 3 dispatch)
        ├── TwoMobileVoiceCaller.java
        ├── sms/                                   (Luồng 1 callers)
        │   ├── SmsSendResult.java
        │   ├── SpeedSmsCaller.java
        │   ├── ESmsCaller.java
        │   ├── VietguysCaller.java
        │   ├── AbenlaCaller.java
        │   ├── InfobipCaller.java
        │   └── CustomHttpSmsCaller.java
        ├── telco/                                 (Luồng 2)
        │   ├── TelcoSmppSessionPool.java
        │   ├── TelcoSmppDispatcher.java
        │   └── TelcoDlrProcessor.java
        └── esl/                                   (Luồng 3)
            ├── EslConnectionPool.java
            ├── FreeSwitchEslDispatcher.java
            └── EslDlrProcessor.java
```

---

## 8. API checklist đầy đủ

### 8.1 Tổng quan

| Router | Prefix | Auth | Số endpoint |
|---|---|---|---|
| Health | `/healthz`, `/readyz`, `/api/v1/ping` | None | 3 |
| Partner inbound | `/api/v1/*` | API key + HMAC SHA-256 | 4 |
| Admin | `/api/admin/*` | JWT Bearer (trừ `/auth/login`, `/auth/refresh`) | 50+ |
| Portal | `/api/portal/*` | JWT Bearer (role=PARTNER) | 11 |
| Internal | `/api/internal/*` | `X-Internal-Secret` header | 1 |

**Global handler order** (xem `VertxConfig`):
1. `BodyHandler.create()` (root, parse body).
2. `/healthz`, `/readyz` ở root.
3. Sub-routers theo prefix.
4. Catch-all 404.
5. `ProblemJsonFailureHandler` (RFC 7807 — `application/problem+json`).

**Rate limit**: hiện CHƯA có (sẽ làm ở Phase 10 qua Nginx `limit_req_zone`).

---

### 8.2 Health & probes (public)

| Method | Path | Handler | Mô tả |
|---|---|---|---|
| GET | `/healthz` | `HealthHandlers.healthz` | Check DB + Redis + RabbitMQ song song qua `executeBlocking`. 200 nếu all UP, 503 nếu any DOWN |
| GET | `/readyz` | `HealthHandlers.readyz` | App readiness (set bởi `ApplicationReadyEvent`) — 200/503 |
| GET | `/api/v1/ping` | `PartnerRouterFactory.anonymous` | `{"pong": true, "group": "partner"}` |

---

### 8.3 Partner inbound — `/api/v1/*` (HMAC required trừ ping)

Header bắt buộc cho `/messages`:
```
X-Api-Key: <keyId>
X-Timestamp: <epoch_seconds>
X-Signature: <hex_hmac_sha256>
```
Ký: `HMAC-SHA256(secret, "{METHOD}:{path}:{sha256(body)}:{timestamp}")`. Replay window 600s qua Redis.

| Method | Path | Handler | Mô tả |
|---|---|---|---|
| POST | `/api/v1/messages` | `PartnerMessageHandlers.send` | Submit 1 message → enqueue `InboundMessageEvent`, trả 202 |
| GET | `/api/v1/messages` | `PartnerMessageHandlers.list` | List messages của partner (filter `from`, `to`, `state`, `dest_addr`, paged) |
| GET | `/api/v1/messages/:id` | `PartnerMessageHandlers.getById` | Detail (IDOR-safe: filter theo partnerId từ context) |

---

### 8.4 Admin — `/api/admin/*` (JWT, trừ login/refresh)

#### Auth & profile

| Method | Path | Handler | Mô tả |
|---|---|---|---|
| POST | `/api/admin/auth/login` | `AuthHandlers.login` | **PUBLIC**. Body `{username, password}` → `{token, refresh_token, expires_in, role, ...}` |
| POST | `/api/admin/auth/refresh` | `AuthHandlers.refresh` | **PUBLIC**. Body `{refresh_token}` → access token mới |
| POST | `/api/admin/auth/logout` | `AuthHandlers.logout` | Blacklist access token + refresh trong Redis |
| GET | `/api/admin/auth/me` | `AuthHandlers.me` | Profile admin hiện tại |

#### Partners + nested resources

| Method | Path | Handler |
|---|---|---|
| POST | `/api/admin/partners` | `PartnerHandlers.create` |
| GET | `/api/admin/partners` | `PartnerHandlers.list` |
| GET | `/api/admin/partners/:id` | `PartnerHandlers.get` |
| PUT | `/api/admin/partners/:id` | `PartnerHandlers.update` |
| DELETE | `/api/admin/partners/:id` | `PartnerHandlers.delete` |
| POST | `/api/admin/partners/:partnerId/smpp-accounts` | `SmppAccountHandlers.create` |
| GET | `/api/admin/partners/:partnerId/smpp-accounts` | `SmppAccountHandlers.list` |
| GET | `/api/admin/partners/:partnerId/smpp-accounts/:id` | `SmppAccountHandlers.get` |
| DELETE | `/api/admin/partners/:partnerId/smpp-accounts/:id` | `SmppAccountHandlers.delete` |
| POST | `/api/admin/partners/:partnerId/api-keys` | `ApiKeyHandlers.create` (trả secret 1 lần) |
| GET | `/api/admin/partners/:partnerId/api-keys` | `ApiKeyHandlers.list` |
| DELETE | `/api/admin/partners/:partnerId/api-keys/:id` | `ApiKeyHandlers.revoke` |
| GET | `/api/admin/partners/:partnerId/rates` | `PartnerRateHandlers.list` |
| POST | `/api/admin/partners/:partnerId/rates` | `PartnerRateHandlers.create` |
| PUT | `/api/admin/partners/:partnerId/rates/:rateId` | `PartnerRateHandlers.update` |
| DELETE | `/api/admin/partners/:partnerId/rates/:rateId` | `PartnerRateHandlers.delete` |

#### Channels + rates + provider lookup

| Method | Path | Handler |
|---|---|---|
| GET | `/api/admin/channels/http-providers` | `ChannelHandlers.listHttpProviders` (static — danh sách provider HTTP_THIRD_PARTY) |
| POST | `/api/admin/channels` | `ChannelHandlers.create` |
| GET | `/api/admin/channels` | `ChannelHandlers.list` (filter `type`, `status`) |
| GET | `/api/admin/channels/:id` | `ChannelHandlers.get` |
| PUT | `/api/admin/channels/:id` | `ChannelHandlers.update` (invalidate route cache) |
| DELETE | `/api/admin/channels/:id` | `ChannelHandlers.delete` (soft → DISABLED, invalidate cache) |
| POST | `/api/admin/channels/:id/test-ping` | `ChannelHandlers.testPing` |
| GET | `/api/admin/channels/:id/stats` | `ChannelHandlers.stats` (period: today/7d/30d) |
| GET | `/api/admin/channels/:id/rates` | `ChannelRateHandlers.list` |
| POST | `/api/admin/channels/:id/rates` | `ChannelRateHandlers.create` |
| PUT | `/api/admin/channels/:id/rates/:rateId` | `ChannelRateHandlers.update` |
| DELETE | `/api/admin/channels/:id/rates/:rateId` | `ChannelRateHandlers.delete` |

#### Routes

| Method | Path | Handler |
|---|---|---|
| POST | `/api/admin/routes` | `RouteHandlers.create` (invalidate route cache) |
| GET | `/api/admin/routes` | `RouteHandlers.list` (filter `partner_id`, `channel_id`) |
| PUT | `/api/admin/routes/:id` | `RouteHandlers.update` |
| DELETE | `/api/admin/routes/:id` | `RouteHandlers.delete` (soft `enabled=false`) |

#### Messages, sessions, stats, users, carriers

| Method | Path | Handler |
|---|---|---|
| GET | `/api/admin/messages` | `MessageHandlers.list` (filter partner_id/state/dest_addr/from/to) |
| GET | `/api/admin/messages/:id` | `MessageHandlers.get` |
| GET | `/api/admin/sessions` | `SessionHandlers.list` (active SMPP server sessions) |
| DELETE | `/api/admin/sessions/:id` | `SessionHandlers.kick` |
| GET | `/api/admin/stats/overview` | `StatsHandlers.overview` |
| GET | `/api/admin/stats/timeseries` | `StatsHandlers.timeseries` (`granularity=hour\|day`) |
| GET | `/api/admin/users` | `UserHandlers.list` |
| GET | `/api/admin/users/:id` | `UserHandlers.get` |
| POST | `/api/admin/users` | `UserHandlers.create` |
| PUT | `/api/admin/users/:id` | `UserHandlers.update` |
| GET | `/api/admin/carriers` | `CarrierHandlers.list` |

---

### 8.5 Portal — `/api/portal/*` (JWT role=PARTNER)

`partnerId` luôn lấy từ JWT claim — KHÔNG đọc từ path/query (IDOR safe).

| Method | Path | Handler | Mô tả |
|---|---|---|---|
| GET | `/api/portal/overview` | `OverviewHandlers.overview` | Dashboard self-service |
| GET | `/api/portal/messages` | `PortalMessageHandlers.list` | Filter theo partnerId của JWT |
| GET | `/api/portal/messages/:id` | `PortalMessageHandlers.get` | Detail (verify ownership) |
| GET | `/api/portal/api-keys` | `PortalApiKeyHandlers.list` | Mask secret |
| POST | `/api/portal/api-keys` | `PortalApiKeyHandlers.create` | Trả secret raw 1 lần |
| POST | `/api/portal/api-keys/:id/revoke` | `PortalApiKeyHandlers.revoke` | |
| GET | `/api/portal/smpp-accounts` | `PortalSmppHandlers.list` | |
| POST | `/api/portal/smpp-accounts/:id/change-password` | `PortalSmppHandlers.changePassword` | |
| PATCH | `/api/portal/webhook` | `WebhookHandlers.update` | Body `{url, secret, retry_max}` |

---

### 8.6 Internal — `/api/internal/*`

Auth: `X-Internal-Secret` header == `app.internal.secret` (env `INTERNAL_SECRET`). KHÔNG expose qua Nginx public.

| Method | Path | Handler | Mô tả |
|---|---|---|---|
| POST | `/api/internal/dlr/:channelId` | `DlrIngressHandler.ingestDlr` | Webhook nhận DLR từ HTTP_THIRD_PARTY. Body `{telco_message_id, state, error_code}`. Lưu Dlr + publish DlrEvent. 204 No Content |

---

## 9. Bảo mật + auth

### 9.1 Phương thức auth

| Loại | Áp dụng | Triển khai |
|---|---|---|
| API key + HMAC SHA-256 | `/api/v1/messages*` | `ApiKeyHmacAuthHandler` + `SecretCipher` |
| JWT Bearer (HS256) | `/api/admin/*`, `/api/portal/*` | `JwtService` + `JwtAuthHandler` (Redis blacklist) |
| `X-Internal-Secret` | `/api/internal/*` | `InternalRouterFactory` |
| SMPP `system_id`+password | port 2775 | `BindAuthenticator` (bcrypt + IP whitelist + max_binds) |

### 9.2 HMAC chi tiết

- Header: `X-Api-Key`, `X-Timestamp` (epoch giây), `X-Signature` (hex).
- Canonical string: `${METHOD}:${path}:${sha256_hex(body)}:${timestamp}`.
- Secret được lưu mã hoá trong DB: `secret_encrypted bytea` + `nonce bytea` (AES-GCM 256, key từ `APP_SECRET_KEY` env). KHÔNG lưu plaintext.
- Skew ±300s; replay window 600s qua Redis `SET NX EX 600`.

### 9.3 JWT chi tiết

- Algorithm HS256, secret từ env `JWT_SECRET`.
- Access token: 15 phút TTL. Refresh: 7 ngày.
- Claims: `sub` (user id), `username`, `role`, `partner_id` (nếu PARTNER), `iat`, `exp`.
- Blacklist Redis `jwt:bl:<jti>` set khi logout. Auth handler check trước khi pass qua.

### 9.4 Cấm + đảm bảo

- KHÔNG expose Postgres/Redis/RabbitMQ AMQP/management ra public.
- KHÔNG expose `/actuator/*` qua Nginx (project chưa dùng Spring Actuator — xem ADR-011).
- TLS bắt buộc cho `/api/admin`, `/api/portal`, `/api/v1` (Nginx Phase 10).
- SMPP partner port 2775 mở public — đã có IP whitelist + max_binds + bcrypt password.

---

## 10. Frontend layout

**Stack**: Next.js 16 App Router, NextAuth v5, Tailwind 4, shadcn/ui.

**Auth flow**:

1. User vào `/login` → form gọi `signIn("credentials", {...})`.
2. NextAuth `Credentials.authorize` POST `/api/admin/auth/login` (BE) → lấy JWT.
3. Fetch `/api/admin/auth/me` lấy role + partner_id.
4. Cookie session NextAuth giữ `accessToken`, `role`, `partnerId`. Refresh tự động trong 5 phút trước khi expire.
5. **Proxy** (`src/proxy.ts`, Next 16's renamed middleware) wrap `auth()`:
   - Chưa auth + `/admin/*` hoặc `/portal/*` → redirect `/login` (kèm `callbackUrl`).
   - Đã auth + visit `/login` → bounce theo role.
   - Cross-role → redirect khu vực đúng.
6. **Layout server-side** (`(admin)/admin/layout.tsx`, `(portal)/portal/layout.tsx`) double-check qua `await auth()` + `redirect(/login)` nếu thiếu/sai role.

**Cấu trúc routes**:

```
src/app/
├── login/page.tsx                       (form NextAuth)
├── page.tsx                             (root → redirect theo role)
├── api/auth/[...nextauth]/route.ts      (NextAuth handler)
├── (admin)/admin/
│   ├── layout.tsx                       (server, await auth())
│   ├── dashboard/page.tsx
│   ├── partners/{,[id]}/page.tsx
│   ├── providers/{,[id]}/page.tsx
│   ├── channels/page.tsx
│   ├── routes/page.tsx
│   ├── messages/page.tsx
│   ├── sessions/page.tsx
│   └── users/page.tsx
└── (portal)/portal/
    ├── layout.tsx
    ├── overview/page.tsx
    ├── messages/page.tsx
    ├── api-keys/page.tsx
    ├── smpp-accounts/page.tsx
    ├── webhook/page.tsx
    └── docs/page.tsx
```

**Env**:
- `API_BASE_INTERNAL` — URL BE (default `http://localhost:8080`).
- `NEXTAUTH_SECRET` — secret encrypt cookie.
- `NEXTAUTH_URL` — public URL FE (production setup).

---

## 11. Hạ tầng + deployment

### 11.1 Local dev (đã chạy)

3 container chia mạng `infra-net`:

```
smpp-postgres   bind 127.0.0.1:5432  vol smpp-dev_postgres_data
smpp-redis      bind 127.0.0.1:6379  vol smpp-dev_redis_data
smpp-rabbitmq   bind 127.0.0.1:5672  + 127.0.0.1:15672 (mgmt UI)
                vol smpp-dev_rabbitmq_data
```

**Build + chạy**:
```bash
cd smpp/backend
JAVA_HOME="C:/Program Files/Java/jdk-21.0.11" ./mvnw -B clean package -DskipTests
java -jar smpp-server/target/smpp-server-0.1.0-SNAPSHOT.jar &
java -jar worker/target/worker-0.1.0-SNAPSHOT.jar &

cd smpp/frontend
"C:/Users/dell/AppData/Local/nvm/nvm.exe" use 22.22.2
pnpm install && pnpm dev          # port 3000
```

### 11.2 Server prod (chưa deploy — Phase 10)

- Host: Ubuntu 24.04 @ `116.118.2.74`.
- SSH: `ssh -i D:/works/tkc-02/.ssh/tamtd tamtd@116.118.2.74`.
- Hạ tầng: `~/apps/infrastructure/` (Postgres/Redis/RabbitMQ — đã chạy).
- App stack: `~/apps/smpp-app/` (sẽ deploy Phase 10).
- Nginx: trên host (không docker), TLS cert qua certbot Let's Encrypt.
- Port public: `80, 443, 2775` qua UFW.

### 11.3 Phase 10 checklist (trích từ `smpp/docs/deploy-checklist.md`)

1. **Pre-flight local**: smoke test FE↔BE thật (login admin → CRUD đi qua các trang).
2. **DNS**: trỏ A record `gw.example.com` → `116.118.2.74` (chọn domain thật).
3. **Tạo `smpp/nginx/`**: vhost `smpp-app.conf` + `ssl-params` + `proxy-params` + `deploy.sh`.
4. **Server config**: UFW open `80/443/2775`; certbot `--nginx`; tạo `~/apps/smpp-app/docker-compose.yml`; `.env` chứa secrets.
5. **Container**: `smpp-server` bind `127.0.0.1:8080` + `0.0.0.0:2775`; `worker` không bind; `frontend` bind `127.0.0.1:3000`.
6. **Smoke test prod**: `curl -I https://gw.example.com/`, `nmap -p 2775 116.118.2.74`, partner SMPP bind từ ngoài.
7. **Post-deploy**: tag `v0.1-phase-10`; bật certbot auto-renew; cron `pg_dump` daily.

---

## 12. Phụ lục — quirks + ADR đã chốt

### 12.1 Quirks gặp phải (đã workaround)

| Vấn đề | Workaround |
|---|---|
| `JAVA_HOME` hệ thống = JDK 8 | Set `JAVA_HOME="C:/Program Files/Java/jdk-21.0.11"` trước `./mvnw` |
| Spring Boot Jackson auto-config cần `spring-web` (không có trong project) | Tự tạo `ObjectMapper` bean với `@Primary @ConditionalOnMissingBean` trong `JacksonConfig` |
| Spring Boot `RedisAutoConfiguration` collision với bean ta | `@AutoConfiguration(before = RedisAutoConfiguration.class)` để bean ta wins |
| `spring.main.lazy-initialization=true` làm Vert.x HttpServer không init | `@Lazy(false)` trên `VertxConfig` — chỉ ép HTTP eager |
| Hibernate validate JDBC metadata khi DB DOWN → app start fail | `spring.jpa.properties.hibernate.boot.allow_jdbc_metadata_access=false` + `hikari.initialization-fail-timeout=-1` |
| Hikari connection-timeout default 30s — healthz quá chậm khi DB down | `spring.datasource.hikari.connection-timeout=2000` |
| jSMPP 3.0.0: `submitShortMessage()` trả `SubmitSmResult`, không phải `String` | Gọi `.getMessageId()` |
| jSMPP 3.0.0: `deliverSm.getEsmClass()` trả `byte` | Dùng `MessageType.SMSC_DEL_RECEIPT.containedIn(byte)` |
| Artifact `link.thingscloud:freeswitch-esl-client:0.9.2` không tồn tại trên Maven Central | Chuyển sang `link.thingscloud:freeswitch-esl:2.2.0` (xem addendum ADR-004) |
| `Partner` entity không có `@Version` | Dùng atomic SQL `UPDATE balance WHERE balance >= :amount` thay optimistic lock |
| Next.js 16: `middleware.ts` đổi tên thành `proxy.ts` | Đặt code auth vào `src/proxy.ts` |

### 12.2 ADR đã chốt (xem `smpp/docs/decisions.md`)

- **ADR-001** — 2 service `smpp-server` + `worker` chia sẻ `core` lib.
- **ADR-002** — Spring Boot 3 + jSMPP cho server inbound.
- **ADR-004** — FreeSWITCH tích hợp qua ESL TCP (addendum 2026-04-28: artifact `link.thingscloud:freeswitch-esl:2.2.0`).
- **ADR-005** — Routing theo partner + msisdn_prefix với fallback chain.
- **ADR-009** — Maven (vs Gradle) cho build BE.
- **ADR-010** — Vert.x Web cho REST, Spring Boot chỉ lifecycle/DI/config.
- **ADR-011** — Tự code `/healthz` + `/readyz` qua Vert.x, KHÔNG Spring Boot Actuator.
- **ADR-012** — `partner_api_key.secret_encrypted` AES-GCM 256, key từ env.
- **ADR-013** — `partner.dlr_webhook` JSONB thay VARCHAR url đơn lẻ.
- **ADR-014** — Provider Adapter Pattern cho HTTP 3rd-party.
- **ADR-015** — Carrier hybrid trong `channel_rate` / `partner_rate` (vừa carrier vừa prefix).

### 12.3 Tham chiếu

| File | Nội dung |
|---|---|
| `smpp/docs/architecture.md` | Sơ đồ kiến trúc tổng thể |
| `smpp/docs/backend.md` | Chi tiết Maven module + worker + dispatcher |
| `smpp/docs/data-model.md` | Schema Postgres + Flyway plan |
| `smpp/docs/api.md` | API spec gốc (admin/portal/partner) |
| `smpp/docs/smpp-protocol.md` | SMPP server inbound (bind/auth/PDU) |
| `smpp/docs/routing.md` | RouteResolver + cache + fallback logic |
| `smpp/docs/dispatchers.md` | 3 dispatcher (HTTP, ESL, SMPP client) |
| `smpp/docs/dlr-flow.md` | DLR ingress + forward chi tiết |
| `smpp/docs/frontend.md` | Next.js layout + auth + role guard |
| `smpp/docs/nginx.md` | Vhost + TLS + UFW config (Phase 10 blueprint) |
| `smpp/docs/roadmap.md` | 10 phase + Definition of Done |
| `smpp/docs/decisions.md` | ADR repository |
| `smpp/docs/deploy-checklist.md` | Phase 10 deployment runbook |
| `smpp/smpp-plan.md` | Source of truth tiến độ implementation |
