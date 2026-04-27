# Roadmap — Implementation Phases

10 phase tuần tự. Mỗi phase đều có **Definition of Done (DoD)**, **smoke test**, **file chính**, và **dependencies**.

Quy ước:
- ✅ Phase trước phải xong và DoD được verify trước khi sang phase sau.
- Khi gặp blocker giữa phase → ghi vào `decisions.md` (nếu là quyết định kiến trúc) hoặc tạo ADR phụ.
- Mọi smoke test có thể chạy trên máy local (Windows + Docker Desktop), không cần SSH server.

---

## Phase 1 — BE skeleton + connect infra

**Goal**: Có 2 Spring Boot app trống chạy được, kết nối được Postgres/Redis/RabbitMQ trong Docker local.

**File chính**:
- `smpp/backend/settings.gradle.kts` — include `core`, `smpp-server`, `worker`
- `smpp/backend/build.gradle.kts` — version catalog, plugins
- `smpp/backend/gradle/libs.versions.toml`
- `smpp/backend/core/src/main/java/vn/vihat/smpp/core/config/{DataSourceConfig,RedisConfig,AmqpConfig}.java`
- `smpp/backend/smpp-server/src/main/java/vn/vihat/smpp/server/ServerApplication.java`
- `smpp/backend/worker/src/main/java/vn/vihat/smpp/worker/WorkerApplication.java`
- `smpp/backend/{smpp-server,worker}/src/main/resources/application.yml`
- `smpp/backend/{smpp-server,worker}/Dockerfile`
- `smpp/backend/docker-compose.yml` (cho local dev infra)

**DoD**:
- `./gradlew build` xanh.
- `docker compose up -d` (local infra) → 3 service healthy.
- `./gradlew :smpp-server:bootRun` log "Started ServerApplication", actuator `/actuator/health` 200 với `db`, `redis`, `rabbit` UP.
- `./gradlew :worker:bootRun` log "Started WorkerApplication", actuator UP.

**Smoke test**:
```bash
curl http://localhost:8080/actuator/health/readiness
# {"status":"UP","components":{...}}
```

**Dependencies**: không.

---

## Phase 2 — Schema V1 + admin auth + CRUD master data

**Goal**: DB schema đầy đủ + admin login JWT + CRUD partner/channel/route.

**File chính**:
- `smpp/backend/core/src/main/resources/db/migration/V1__init.sql` (toàn bộ 8 bảng — xem `data-model.md`)
- `smpp/backend/core/src/main/java/vn/vihat/smpp/core/domain/*.java` (entity)
- `smpp/backend/core/src/main/java/vn/vihat/smpp/core/repository/*.java`
- `smpp/backend/smpp-server/src/main/java/vn/vihat/smpp/server/auth/{JwtService,AdminAuthFilter,LoginController}.java`
- `smpp/backend/smpp-server/src/main/java/vn/vihat/smpp/server/api/admin/*Controller.java`
- `smpp/backend/smpp-server/src/main/resources/db/data/V900__seed_admin.sql` (admin user mặc định)

**DoD**:
- Flyway migrate xong, 8 bảng tồn tại trong `smpp_db`.
- `POST /api/admin/auth/login` với username/password seed → trả JWT.
- CRUD `/api/admin/partners`, `/api/admin/channels`, `/api/admin/routes` đầy đủ.
- Bearer JWT validation hoạt động (request không có/sai → 401).

**Smoke test**:
```bash
TOKEN=$(curl -X POST http://localhost:8080/api/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<bootstrap>"}' | jq -r .token)

curl -X POST http://localhost:8080/api/admin/partners \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"code":"VIETTEL","name":"Viettel Telecom"}'
```

**Dependencies**: Phase 1.

---

## Phase 3 — SMPP server + partner bind auth + submit_sm

**Goal**: Partner bind được vào port 2775, gửi `submit_sm` thành công, message lưu DB và đẩy vào RabbitMQ.

**File chính**:
- `smpp/backend/smpp-server/src/main/java/vn/vihat/smpp/server/smpp/{SmppServerConfig,BindAuthenticator,MessageReceiverListenerImpl,SessionRegistry}.java`
- `smpp/backend/core/src/main/java/vn/vihat/smpp/core/messaging/{Exchanges,Queues,RoutingKeys}.java`
- `smpp/backend/core/src/main/java/vn/vihat/smpp/core/security/PasswordHasher.java`

**DoD**:
- jSMPP listener bind port 2775.
- Partner bind đúng `system_id+password` → accept; sai → reject `ESME_RBINDFAIL`.
- IP whitelist enforce (nếu có).
- `submit_sm` → row `message` state=RECEIVED + AMQP message vào exchange `sms.inbound`.
- Session đang active xuất hiện trong `smpp:session:<system_id>` (Redis hash).

**Smoke test**:
```bash
# Tạo partner_smpp_account qua admin API
# Dùng smppcli (npm install -g smppcli)
smppcli bind transceiver -h localhost -p 2775 -u test -P testpass
> submit_sm dest=84901234567 source=VHT message="hello"
# → server trả message_id
# Check DB: SELECT * FROM message WHERE source_addr='VHT';
# Check RabbitMQ Management UI queue sms.inbound.q có message
```

**Dependencies**: Phase 2.

---

## Phase 4 — HTTP partner inbound + API key + HMAC signature

**Goal**: Partner gọi `POST /api/v1/messages` với HMAC signing, message vào pipeline tương đương SMPP.

**File chính**:
- `smpp/backend/smpp-server/src/main/java/vn/vihat/smpp/server/auth/{ApiKeyFilter,SignatureVerifier}.java`
- `smpp/backend/smpp-server/src/main/java/vn/vihat/smpp/server/api/partner/MessagesController.java`
- `smpp/backend/core/src/main/java/vn/vihat/smpp/core/security/HmacSigner.java`
- `smpp/backend/smpp-server/src/main/java/vn/vihat/smpp/server/inbound/MessagePublisher.java` (refactor từ phase 3)

**DoD**:
- API key tạo qua `/api/admin/partners/{id}/keys` (trả secret 1 lần duy nhất).
- `POST /api/v1/messages` với header đúng → 202, message lưu DB + publish AMQP.
- Header sai/timestamp lệch >5p → 401.
- Replay (cùng signature trong cache Redis) → 401.

**Smoke test**:
```bash
# Tạo key qua admin
KEY_ID=...; SECRET=...
TS=$(date +%s)
BODY='{"source_addr":"VHT","dest_addr":"84901234567","content":"hi"}'
SIG=$(echo -n "POST/api/v1/messages${TS}${BODY}" | openssl dgst -sha256 -hmac "$SECRET" -hex | cut -d' ' -f2)

curl -X POST http://localhost:8080/api/v1/messages \
  -H "X-Api-Key: $KEY_ID" -H "X-Timestamp: $TS" -H "X-Signature: $SIG" \
  -d "$BODY"
```

**Dependencies**: Phase 2 (admin CRUD), Phase 3 (publisher pattern).

---

## Phase 5 — Worker + RouteResolver + HttpThirdPartyDispatcher

**Goal**: Worker consume `sms.inbound`, route theo partner+prefix, dispatch tới 1 channel HTTP_THIRD_PARTY (mock httpbin).

**File chính**:
- `smpp/backend/worker/src/main/java/vn/vihat/smpp/worker/inbound/SmsInboundConsumer.java`
- `smpp/backend/worker/src/main/java/vn/vihat/smpp/worker/route/{RouteResolver,RouteCache}.java`
- `smpp/backend/worker/src/main/java/vn/vihat/smpp/worker/dispatch/{ChannelDispatcher,HttpThirdPartyDispatcher}.java`
- `smpp/backend/worker/src/main/java/vn/vihat/smpp/worker/client/Http3rdPartyClient.java`

**DoD**:
- Cấu hình channel HTTP_THIRD_PARTY trỏ tới `https://httpbin.org/post`.
- Tạo route prefix `849` cho partner X → channel trên.
- Submit message qua phase 3 hoặc 4 → log worker thấy POST tới httpbin → state=SUBMITTED → DELIVERED.
- Cache route trong Redis (TTL 60s); admin update route → cache invalidate.
- Idempotency: cùng message_id retry không double-dispatch (Redis SETNX).

**Smoke test**:
```bash
# Submit qua HTTP API như phase 4
# Check log worker: "dispatched message <id> to channel httpbin"
# Check DB: SELECT state FROM message WHERE id='<id>';
# → SUBMITTED hoặc DELIVERED
```

**Dependencies**: Phase 4.

---

## Phase 6 — TelcoSmppDispatcher + DLR ingress + DLR forward

**Goal**: Vòng tròn DLR đầy đủ qua channel telco SMPP.

**File chính**:
- `smpp/backend/worker/src/main/java/vn/vihat/smpp/worker/dispatch/TelcoSmppDispatcher.java`
- `smpp/backend/worker/src/main/java/vn/vihat/smpp/worker/client/{TelcoSmppSessionPool,TelcoSmppSession}.java`
- `smpp/backend/worker/src/main/java/vn/vihat/smpp/worker/dlr/DlrIngressHandler.java`
- `smpp/backend/smpp-server/src/main/java/vn/vihat/smpp/server/outbound/DlrForwarder.java`

**DoD**:
- Channel TELCO_SMPP với host = local `smppsim` (Docker compose dev profile).
- Submit message qua route → worker bind ra smppsim → smppsim trả `submit_sm_resp`.
- Sau 5s smppsim trả `deliver_sm` (DLR) → worker save record `dlr` + update message state=DELIVERED → publish `sms.dlr`.
- smpp-server consume `sms.dlr` → nếu partner có session SMPP active thì gửi `deliver_sm` trong session đó.
- Webhook fallback: partner không có session SMPP nhưng có `dlr_webhook_url` → POST JSON tới URL đó (test với httpbin).

**Smoke test**:
```bash
# bind smppcli ở 2 terminal:
# Terminal 1: bind partner X → submit_sm
# Terminal 2: bind partner X (lần 2) → enquire_link → đợi nhận deliver_sm DLR
```

**Dependencies**: Phase 5.

---

## Phase 7 — FreeSwitchEslDispatcher (voice OTP)

**Goal**: Channel FREESWITCH_ESL hoạt động: route message → originate call → playback OTP digit → mark state theo hangup cause.

**File chính**:
- `smpp/backend/worker/src/main/java/vn/vihat/smpp/worker/dispatch/FreeSwitchEslDispatcher.java`
- `smpp/backend/worker/src/main/java/vn/vihat/smpp/worker/client/{EslClientPool,EslEventHandler}.java`

**DoD**:
- Channel FREESWITCH_ESL config `host`, `port`, `password`, `dialplan_template`.
- Worker connect ESL inbound, listen events.
- Submit message → originate call → CHANNEL_HANGUP_COMPLETE event → state=DELIVERED (hangup_cause=NORMAL_CLEARING) hoặc FAILED.
- Test với FreeSWITCH local Docker container (image `signalwire/freeswitch`).

**Smoke test**:
```bash
# Cần FS local + 1 SIP softphone (Linphone) làm "khách" trả lời cuộc gọi
# Submit message → softphone reo → trả lời → nghe TTS → cúp máy
# → check message state=DELIVERED
```

**Dependencies**: Phase 5 (dispatcher pattern), FreeSWITCH local instance setup.

---

## Phase 8 — Frontend skeleton + login + admin dashboard

**Goal**: Next.js app chạy được, login bằng JWT, admin dashboard hiển thị tổng quan.

**File chính**:
- `smpp/frontend/package.json`
- `smpp/frontend/next.config.ts`, `tsconfig.json`, `tailwind.config.ts`
- `smpp/frontend/src/app/layout.tsx`
- `smpp/frontend/src/app/login/page.tsx`
- `smpp/frontend/src/app/(admin)/admin/dashboard/page.tsx`
- `smpp/frontend/src/lib/{auth.ts,api.ts}`
- `smpp/frontend/src/middleware.ts`
- `smpp/frontend/Dockerfile`

**DoD**:
- `pnpm dev` chạy port 3000.
- Login admin → cookie session set, redirect `/admin/dashboard`.
- Dashboard fetch `/api/admin/messages?from=...&to=...&aggregate=hourly` (cần BE thêm endpoint nhỏ này) → render Recharts.
- Middleware redirect đúng (chưa login → /login; sai role → trang phù hợp).

**Smoke test**:
- Mở `http://localhost:3000/login` → đăng nhập → thấy chart + stats.
- Cố mở `http://localhost:3000/portal/overview` khi đang là admin → bị redirect về `/admin/dashboard`.

**Dependencies**: Phase 2 (admin API).

---

## Phase 9 — Frontend admin CRUD đầy đủ + portal MVP

**Goal**: Operator quản lý partner/channel/route/message qua UI; partner login portal xem traffic của mình.

**File chính** (admin):
- `smpp/frontend/src/app/(admin)/admin/{partners,channels,routes,messages,sessions}/page.tsx`
- Detail pages `[id]/page.tsx`
- `smpp/frontend/src/components/data-table/` (TanStack Table)

**File chính** (portal):
- `smpp/frontend/src/app/(portal)/portal/{overview,messages,api-keys,docs}/page.tsx`

**DoD**:
- Admin: CRUD đầy đủ qua UI, search/filter message, kick session.
- Portal: partner login (cùng login form, server trả role=PARTNER), thấy chỉ message của mình (BE filter theo JWT claim partner_id), tạo/rotate API key (UI hiện secret 1 lần).

**Smoke test**:
- Tạo partner X qua admin UI → tạo SMPP account + API key → chuyển sang tab ẩn danh login portal X → thấy traffic chỉ của X.

**Dependencies**: Phase 8 + Phase 4 (API key endpoint).

---

## Phase 10 — Nginx vhost + TLS + deploy server prod

**Goal**: Hệ thống chạy thật trên `116.118.2.74` với HTTPS, accessible qua domain.

**File chính**:
- `smpp/nginx/conf.d/smpp-app.conf`
- `smpp/nginx/snippets/{ssl-params,proxy-params}.conf`
- `smpp/nginx/deploy.sh`
- `smpp/nginx/README.md`
- Cập nhật `smpp/backend/docker-compose.yml` cho path deploy

**DoD**:
- Domain trỏ DNS A record về `116.118.2.74`.
- `certbot --nginx` tạo cert cho domain.
- UFW mở 80, 443, 2775.
- App stack deploy `~/apps/smpp-app/`, container chạy healthy.
- `https://<domain>/` → frontend; `https://<domain>/api/v1/messages` → BE.
- Partner thật bind SMPP port 2775 từ ngoài internet → bind OK.

**Smoke test**:
```bash
curl -I https://<domain>/                           # 200
curl -I https://<domain>/api/admin/auth/login -X POST -d ... # 200
curl -I https://<domain>/actuator/health            # 404 (ẩn)
nmap -p 2775 116.118.2.74                            # open
```

**Dependencies**: Phase 5+ (BE chạy ổn), Phase 9 (FE đủ chức năng).

---

## Tổng quát

- Phase 1-2 là nền tảng, không thể skip.
- Phase 3-4 song song được (1 dev SMPP, 1 dev HTTP).
- Phase 5-7 song song được sau khi phase 4 xong (3 dispatcher khác nhau, không đụng nhau).
- Phase 8-9 song song với phase 5-7 nếu có dev FE riêng.
- Phase 10 chỉ làm khi tất cả còn lại stable trên local.

Khi mỗi phase hoàn tất → commit + tag git (`v0.1-phase-N`), update `decisions.md` nếu có thay đổi.
