# Deploy Checklist — Production rollout

> Document tổng hợp **trạng thái implementation hiện tại** + **các bước còn lại để đưa hệ thống lên server prod** `116.118.2.74`.
> Cập nhật `2026-04-28` sau khi hoàn thành Luồng 1–5 và khôi phục login flow FE.

---

## 1. Trạng thái implementation

### Backend (`smpp/backend/`) ✅ Phase 1–7 done

| Layer | Trạng thái |
|---|---|
| Maven multi-module (core / smpp-server / worker) | ✅ build `mvnw clean package -DskipTests` 4 module SUCCESS |
| Postgres schema (Flyway V1–V3 + V900 seed) | ✅ 8 bảng + carrier_prefix + provider/pricing addon |
| Admin auth (JWT + refresh, role guard) | ✅ `/api/admin/auth/{login,refresh,me}` |
| Admin CRUD master data | ✅ partners / smpp-accounts / api-keys / channels / channel-rates / partner-rates / routes / carriers / messages / sessions / users / stats |
| Portal API (partner-self) | ✅ overview / messages / api-keys / smpp-accounts / webhook |
| Partner inbound (HTTP) — `POST /api/v1/messages` | ✅ API key + HMAC SHA-256 bearer |
| Partner inbound (SMPP) — port 2775 | ✅ jSMPP listener + bcrypt bind auth + submit_sm → AMQP enqueue |
| DLR ingress webhook — `POST /api/internal/dlr/{channelId}` | ✅ HTTP_THIRD_PARTY DLR |
| DLR forwarder → partner | ✅ `DlrForwarder` consume `sms.dlr.q` → HTTP webhook hoặc SMPP `deliver_sm` |
| **Luồng 1** — SMS HTTP 3rd-party dispatch | ✅ SpeedSMS / eSMS / Vietguys / Abenla / Infobip / CUSTOM |
| **Luồng 2** — SMPP outbound tới telco SMSC | ✅ `TelcoSmppSessionPool` + `TelcoSmppDispatcher` + `TelcoDlrProcessor` |
| **Luồng 3** — FreeSWITCH ESL voice OTP | ✅ `EslConnectionPool` + `FreeSwitchEslDispatcher` + `EslDlrProcessor` (artifact `link.thingscloud:freeswitch-esl:2.2.0`) |
| **Luồng 4** — Rate billing (deduct partner balance) | ✅ atomic SQL `UPDATE balance WHERE balance >= :amount` qua `PartnerBalanceService` |
| **Luồng 5** — Redis route cache TTL 60s | ✅ `RouteResolver` cache + invalidation trong `RouteHandlers`/`ChannelHandlers` |

### Frontend (`smpp/frontend/`) — Phase 8–9 partial

| Trang | Trạng thái UI | Wire BE |
|---|---|---|
| `/login` | ✅ form đầy đủ | ✅ NextAuth Credentials → BE `/api/admin/auth/login` |
| `/admin/dashboard` | ✅ KPI + chart | ⚠ chưa runtime test với BE |
| `/admin/partners`, `/admin/providers`, `/admin/channels`, `/admin/routes`, `/admin/messages`, `/admin/sessions`, `/admin/users` | ✅ list + detail page | ⚠ chưa runtime test với BE |
| `/portal/overview`, `/portal/api-keys`, `/portal/smpp-accounts`, `/portal/messages`, `/portal/webhook`, `/portal/docs` | ✅ UI có | ⚠ chưa runtime test với BE |
| `proxy.ts` (Next 16 tên mới của middleware) | ✅ NextAuth-aware role guard | — |
| Layout admin/portal | ✅ `auth()` server-side check, redirect /login nếu missing/wrong role | — |

> **Auth bypass đã gỡ** trong commit gần nhất. Trước khi smoke test FE bắt buộc start cả BE — login form sẽ POST tới `http://localhost:8080/api/admin/auth/login`.

### Infra (Docker `infra-net`) ✅ ready

3 container chạy compose riêng (không trong repo này):
- `smpp-postgres` (Postgres 16, port `127.0.0.1:5432`)
- `smpp-redis` (Redis 7, port `127.0.0.1:6379`)
- `smpp-rabbitmq` (RabbitMQ 3.13, ports `127.0.0.1:5672` AMQP + `127.0.0.1:15672` mgmt)

Volumes: `smpp-dev_postgres_data` / `smpp-dev_redis_data` / `smpp-dev_rabbitmq_data` — KHÔNG `docker compose down -v`.

### Phase còn lại theo `roadmap.md`

| Phase | Goal | Trạng thái |
|---|---|---|
| 8 | FE skeleton + login + admin dashboard | UI ✅, login wire ✅, runtime smoke chưa |
| 9 | FE admin CRUD đầy đủ + portal MVP | UI ✅, runtime smoke chưa |
| 10 | Nginx vhost + TLS + deploy server prod | **Chưa làm** |

---

## 2. Phase 10 — Deploy server prod (next steps)

### 2.1 Pre-flight (chạy trước trên local)

- [ ] Smoke test FE end-to-end với BE thật:
  - Start infra (`docker start smpp-postgres smpp-redis smpp-rabbitmq`)
  - Start BE: `cd smpp/backend && JAVA_HOME=… ./mvnw -pl smpp-server -am spring-boot:run`
  - Start worker: `JAVA_HOME=… java -jar smpp/backend/worker/target/worker-*.jar`
  - Start FE: `cd smpp/frontend && pnpm dev` (Node ≥ 20.9, đã có nvm-windows v22.22.2)
  - Login `admin / Admin@123456`, đi qua các trang admin/portal — verify CRUD chạy thật, không 401/500.
  - Tạo 1 partner test, gửi 1 message qua `POST /api/v1/messages` (HMAC), kiểm `partner.balance` giảm + Redis có cache key.

- [ ] Thiết lập DNS:
  - Trỏ A record `gw.example.com` (chọn domain thật) → `116.118.2.74`.
  - Có thể dùng staging subdomain trước: `staging-gw.example.com`.

- [ ] FE build production: `cd smpp/frontend && pnpm build` — verify không lỗi build.
- [ ] BE build container: `docker compose -f smpp/backend/docker-compose.yml build` — image `smpp-server:dev` + `worker:dev`.

### 2.2 Tạo nginx files (chưa có)

`smpp/nginx/` hiện đang rỗng. Cần tạo theo blueprint `smpp/docs/nginx.md`:

- [ ] `smpp/nginx/conf.d/smpp-app.conf` — vhost chính (HTTP→HTTPS redirect + HTTPS proxy):
  - `/` → `127.0.0.1:3000` (FE Next.js)
  - `/api/v1/*` → `127.0.0.1:8080` (partner inbound, rate limit `100r/s`)
  - `/api/admin/*`, `/api/portal/*` → `127.0.0.1:8080`
  - `/api/internal/*` → **chỉ allow** từ subnet partner đã whitelist hoặc bind tới `127.0.0.1` only
  - `/actuator/*` → `deny all` (không expose ra public)
- [ ] `smpp/nginx/snippets/ssl-params.conf` — TLS protocols (TLSv1.2 + 1.3), HSTS, OCSP stapling
- [ ] `smpp/nginx/snippets/proxy-params.conf` — proxy headers + timeouts + keepalive
- [ ] `smpp/nginx/deploy.sh` — `rsync` files lên server + `sudo nginx -t && sudo systemctl reload nginx`
- [ ] `smpp/nginx/README.md` — hướng dẫn install certbot + UFW

### 2.3 Cấu hình server (`116.118.2.74`)

SSH `tamtd@116.118.2.74` (key `D:\works\tkc-02\.ssh\tamtd`).

- [ ] **UFW**: mở 80 (HTTP→HTTPS redirect + certbot challenge), 443 (HTTPS), 2775 (SMPP partner). KHÔNG expose 5432/6379/5672/15672/8080.
  ```bash
  sudo ufw allow 80,443,2775/tcp
  sudo ufw status
  ```
- [ ] **Certbot**: `sudo apt install certbot python3-certbot-nginx`, sau đó `sudo certbot --nginx -d gw.example.com`.
- [ ] **Stack folder**: `~/apps/smpp-app/` chứa `docker-compose.yml` (copy từ repo), `.env` chứa secrets (KHÔNG commit), join external network `infra-net`.
- [ ] **Container**:
  - `smpp-server` bind `127.0.0.1:8080:8080` + `0.0.0.0:2775:2775` (SMPP cần public port).
  - `worker` không bind port.
  - `frontend` bind `127.0.0.1:3000:3000` (chỉ Nginx truy cập).
- [ ] **Env vars**: `APP_SECRET_KEY` (AES-GCM 256), `JWT_SECRET`, DB/Redis/Rabbit creds, `API_BASE_INTERNAL=http://smpp-server:8080` cho FE container.

### 2.4 Deploy script

- [ ] `smpp/backend/deploy.sh` (mới): build image qua docker buildx → push tới registry private hoặc save+scp → `ssh tamtd@... 'cd ~/apps/smpp-app && docker compose pull && docker compose up -d'`.
- [ ] Hoặc deploy qua GitHub Actions (sau, tốn thêm setup secrets).

### 2.5 Smoke test prod (DoD Phase 10)

```bash
curl -I https://gw.example.com/                                      # 200 (FE)
curl -X POST https://gw.example.com/api/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@123456"}'                 # 200 với JWT
curl -I https://gw.example.com/actuator/health                        # 404 (đã ẩn)
nmap -p 2775 116.118.2.74                                             # open
nmap -p 5432,6379,5672,15672 116.118.2.74                             # closed (firewall)
```

- [ ] Thử bind SMPP từ partner test (tool `smppsim` hoặc jSMPP client local) tới `116.118.2.74:2775` → submit 1 SMS test.
- [ ] Verify message lưu DB + worker dispatch → check log container.
- [ ] Verify TLS rating ≥ A trên `https://www.ssllabs.com/ssltest/`.

### 2.6 Post-deploy

- [ ] Tag git: `v0.1-phase-10`.
- [ ] Cập nhật `smpp/smpp-plan.md`: mark Phase 10 done.
- [ ] Bật certbot auto-renew: `sudo systemctl enable --now certbot.timer`.
- [ ] Backup plan: cron `pg_dump` hằng ngày → `~/backups/`, rotate 14 ngày (Phase 11 ngoài roadmap, tuỳ).

---

## 3. Risks / open questions

- **Domain thật**: roadmap dùng placeholder `gw.example.com`. Cần chọn domain trước khi cấu hình certbot. Có thể staging trước với Let's Encrypt staging cert (tránh hit rate limit).
- **Nginx config chưa được review**: blueprint trong `smpp/docs/nginx.md` chưa được test; cần verify rate-limit zones tránh khoá legitimate partner traffic.
- **FE container Dockerfile chưa có**: `smpp/frontend/Dockerfile` chưa tồn tại — cần thêm trước khi compose có service `frontend`.
- **Partner DLR forwarding**: hiện DLR forwarder gửi callback HTTP từ container `worker`. Khi deploy prod cần bảo đảm worker host có DNS ra ngoài (ok vì compose mặc định có internet egress).
- **Observability**: phase 1 chỉ Spring Actuator + log file — chưa Prometheus/Grafana/Loki. Đề xuất thêm `phase 11 — observability` sau khi prod stable.

---

## 4. Quick reference — current build/run commands

```bash
# Backend
cd smpp/backend
JAVA_HOME="C:/Program Files/Java/jdk-21.0.11" ./mvnw -B clean package -DskipTests
JAVA_HOME="C:/Program Files/Java/jdk-21.0.11" java -jar smpp-server/target/smpp-server-0.1.0-SNAPSHOT.jar
JAVA_HOME="C:/Program Files/Java/jdk-21.0.11" java -jar worker/target/worker-0.1.0-SNAPSHOT.jar

# Frontend (Node 22 qua nvm-windows)
"C:/Users/dell/AppData/Local/nvm/nvm.exe" use 22.22.2
cd smpp/frontend
pnpm install        # hoặc npx pnpm install nếu chưa có pnpm global
pnpm dev            # dev server port 3000 (FE → BE qua API_BASE_INTERNAL=http://localhost:8080)
pnpm build          # production build verify

# Infra (đã chạy local)
docker ps --filter "name=smpp-postgres|smpp-redis|smpp-rabbitmq"
# Nếu stopped: docker start smpp-postgres smpp-redis smpp-rabbitmq

# Server prod (chưa deploy)
ssh -i D:/works/tkc-02/.ssh/tamtd tamtd@116.118.2.74
```
