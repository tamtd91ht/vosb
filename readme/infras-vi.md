# SMPP Platform - Infrastructure Documentation (có chú thích tiếng Việt)

> **Mục đích**: Tài liệu này mô tả hạ tầng (infrastructure) đã được dựng cho dự án SMPP server. Dùng làm nguồn thông tin chính khi scaffold source backend (Java) và frontend ở máy local.
>
> **Hướng dẫn đọc**: Mỗi section có phần chú thích tiếng Việt phía dưới (in nghiêng) để giải thích vì sao quyết định như vậy, dùng để làm gì, và lưu ý gì khi build app.

---

## 1. Server Information / Thông tin Server

| Item | Value |
|------|-------|
| OS | Ubuntu 24.04.4 LTS |
| Kernel | 6.8.0-110-generic |
| Public IP | `116.118.2.74` |
| Hostname | `vt` |
| Architecture | x86_64 |
| Timezone | Asia/Ho_Chi_Minh |

### Access / Truy cập

- SSH user: `tamtd` (sudo enabled, password locked for root)
- SSH port: `22`
- SSH authentication: **Public key only** (password authentication disabled)
- Private key path on local Windows: `D:\works\tkc-02\.ssh\tamtd`
- SSH command: `ssh -i D:\works\tkc-02\.ssh\tamtd tamtd@116.118.2.74`

> 🇻🇳 **Chú thích**: Server đã tắt hoàn toàn login bằng password. Chỉ vào được bằng SSH key. Nếu mất file private key `tamtd` thì sẽ phải vào console của nhà cung cấp VPS để reset. **Backup private key vào nơi an toàn (password manager hoặc USB).**

### Security Hardening Applied / Bảo mật đã áp dụng

- UFW firewall: enabled, default deny incoming, allow port 22 only
- Fail2ban: active on `sshd` jail (bantime 1h, maxretry 3, findtime 10m)
- SSH: `PermitRootLogin no`, `PasswordAuthentication no`, `PubkeyAuthentication yes`
- Root account: password locked (`passwd -l root`)
- Auto security updates: `unattended-upgrades` enabled

> 🇻🇳 **Chú thích**:
> - **UFW** chặn mọi connection từ ngoài, chỉ cho phép port 22 (SSH). Khi triển khai app sẽ cần mở thêm port 80, 443, 2775.
> - **Fail2ban** tự động ban IP nếu thử sai SSH 3 lần trong 10 phút (ban 1 giờ).
> - **Root** không login được trực tiếp nữa, phải dùng `tamtd` rồi `sudo`.
> - **unattended-upgrades** tự động cập nhật bản vá bảo mật mỗi đêm. Nếu cần reboot do update kernel sẽ có file `/var/run/reboot-required`.

---

## 2. Architecture Overview / Tổng quan kiến trúc

The deployment is split into two independent stacks:

```
~/apps/
├── infrastructure/      ← Stateful services (DB, cache, MQ)
└── smpp-app/            ← Stateless application code (BE, FE)
```

> 🇻🇳 **Chú thích triết lý kiến trúc**: **Tách riêng hạ tầng và ứng dụng** là quyết định quan trọng nhất. Lợi ích:
> - Restart/deploy app không ảnh hưởng database
> - Update DB version độc lập (vd: PG 16 → 17) không phải đụng app
> - Sau này có thêm app B, app C cũng dùng chung được hạ tầng này
> - Backup hạ tầng riêng, backup app code riêng, dễ quản lý
> - Lifecycle khác nhau: app có thể deploy 10 lần/ngày, hạ tầng vài tháng mới động

The two stacks communicate over a shared Docker network (`infra-net`) declared as `external` in each `docker-compose.yml`. This separation lets the application be redeployed without affecting infrastructure data, and allows future apps to share the same infrastructure.

### Network Topology / Sơ đồ network

```
                      Internet
                         │
                ┌────────┴────────┐
                │  Nginx (host)   │   Reverse proxy + TLS
                │   :80, :443     │
                └────────┬────────┘
                         │
        ┌────────────────┼────────────────┐
        │                                 │
   ┌────▼─────┐                     ┌─────▼────┐
   │ frontend │                     │ backend  │
   │  :3000   │                     │  :8080   │
   └────┬─────┘                     └─────┬────┘
        │              app-net            │
        └──────────────────────────────────┘
                                          │
                                  Backend cũng join
                                  infra-net để
                                  truy cập DB/Redis/MQ
                                          │
                  ┌───────────────────────┼──────────────────┐
                  │                       │                  │
            ┌─────▼─────┐          ┌──────▼──────┐    ┌──────▼──────┐
            │ postgres  │          │    redis    │    │  rabbitmq   │
            │   :5432   │          │    :6379    │    │   :5672     │
            └───────────┘          └─────────────┘    └─────────────┘
                                          infra-net
```

**Key invariants / Nguyên tắc bất biến:**
- PostgreSQL (5432), Redis (6379), and RabbitMQ AMQP (5672) are **never** exposed on the host.
- RabbitMQ Management UI (15672) is bound to `127.0.0.1` only — accessible via SSH tunnel.
- The SMPP listener port (planned: 2775) is the only application port intentionally exposed publicly besides 80/443.

> 🇻🇳 **Chú thích bảo mật mạng**:
> - **TUYỆT ĐỐI** không expose port database (5432, 6379, 5672) ra internet. Đây là sai lầm phổ biến nhất khiến server bị hack. Database chỉ được truy cập từ trong Docker network nội bộ.
> - **Management UI của RabbitMQ** (port 15672) chỉ bind localhost — muốn xem từ máy local phải dùng SSH tunnel: `ssh -L 15672:127.0.0.1:15672 tamtd@116.118.2.74`.
> - **Backend join 2 network**: `infra-net` (để nói chuyện với DB) và `app-net` (để nói chuyện với frontend qua Nginx). Frontend chỉ cần `app-net`.
> - **Port 2775** là port chuẩn của giao thức SMPP (giống port 25 của SMTP, 80 của HTTP). Đây là port duy nhất của app expose ra internet ngoài 80/443.

---

## 3. Directory Layout / Cấu trúc thư mục

```
/home/tamtd/apps/
├── infrastructure/
│   ├── docker-compose.yml
│   ├── .env                      # Secrets, chmod 600
│   ├── postgres/
│   │   └── data/                 # Bind-mounted PG data dir
│   ├── redis/
│   │   └── data/                 # Bind-mounted Redis AOF + RDB
│   ├── rabbitmq/
│   │   └── data/                 # Bind-mounted RabbitMQ data dir
│   ├── scripts/
│   │   └── backup.sh             # Daily backup script
│   └── backup/                   # Backup output dir (rotated 7 days)
└── smpp-app/
    ├── backend/                  # Java backend (chưa build)
    ├── frontend/                 # Frontend (chưa build)
    └── nginx/                    # Reverse proxy config (chưa cấu hình)
```

> 🇻🇳 **Chú thích lựa chọn bind mount vs named volume**:
> - Đang dùng **bind mount** (`./postgres/data:/var/lib/postgresql/data`) thay vì **named volume** (`postgres_data:/var/lib/postgresql/data`).
> - Lý do: bind mount cho phép thấy data trực tiếp trong filesystem, dễ backup bằng `tar`/`rsync`, dễ migrate sang server khác (chỉ cần copy folder).
> - Nhược điểm: phải cẩn thận với permission. Postgres trong container chạy với UID 70 (Alpine), file ghi ra host sẽ thuộc UID 70 — `ls -la` sẽ thấy số UID lạ. Đây là bình thường, không cần `chown`.
> - **KHÔNG BAO GIỜ** xóa hay sửa thủ công file trong `postgres/data/` khi container đang chạy → corrupt database.

---

## 4. Docker Network

A shared external bridge network is created once and referenced by both compose files.

```bash
docker network create infra-net
```

**Network ID** (informational): `2bc12ab23a49`
**Driver**: `bridge`
**Subnet**: auto-assigned by Docker (currently `172.18.0.0/16`)

Container DNS names are resolvable across the network:

| Container | DNS name | Internal IP (current) |
|-----------|----------|-----------------------|
| postgres  | `postgres`  | 172.18.0.2 |
| redis     | `redis`     | 172.18.0.3 |
| rabbitmq  | `rabbitmq`  | 172.18.0.4 |

> Backend connects using DNS names, **not** IPs. IPs may change on container recreation.

> 🇻🇳 **Chú thích cực kỳ quan trọng**:
> - Khi viết code backend, **dùng tên container** (`postgres`, `redis`, `rabbitmq`) làm hostname, **KHÔNG dùng IP** (`172.18.0.2`).
> - IP có thể đổi mỗi lần container restart. Tên container thì cố định.
> - Docker có DNS internal tự resolve tên container → IP đúng.
> - Ví dụ trong file `application.yml` của Spring Boot:
>   ```yaml
>   spring:
>     datasource:
>       url: jdbc:postgresql://postgres:5432/smpp_db   # ← dùng "postgres", không phải IP
>   ```

---

## 5. Infrastructure Services / Các dịch vụ hạ tầng

### 5.1 PostgreSQL

| Property | Value |
|----------|-------|
| Image | `postgres:16-alpine` |
| Container name | `postgres` |
| Internal port | `5432` |
| Host port | not exposed |
| Database name | `smpp_db` |
| Username | `smpp_user` |
| Password | see `.env` (`POSTGRES_PASSWORD`) |
| Data volume | `./postgres/data → /var/lib/postgresql/data` |
| Restart policy | `unless-stopped` |
| Healthcheck | `pg_isready -U smpp_user -d smpp_db` every 10s |

**Connection string for backend (inside Docker):**
```
jdbc:postgresql://postgres:5432/smpp_db
```

> 🇻🇳 **Chú thích PostgreSQL**:
> - **Phiên bản 16-alpine**: chọn alpine vì image nhỏ (~80MB so với ~400MB của bản full). Đủ tính năng cho 99% use case.
> - **`smpp_db`** là database mặc định, có thể tạo thêm database khác nếu cần (ví dụ `smpp_test` cho test).
> - **`smpp_user`** đã có quyền owner trên `smpp_db` → tạo bảng, index thoải mái.
> - **Healthcheck** chạy `pg_isready` mỗi 10s. Status `(healthy)` trong `docker compose ps` mới có nghĩa là sẵn sàng nhận connection.
> - **Restart policy `unless-stopped`**: container tự lên lại khi crash hoặc khi server reboot, NHƯNG nếu user `docker stop postgres` thì sẽ KHÔNG tự lên (cố ý, để admin có thể tạm tắt).

### 5.2 Redis

| Property | Value |
|----------|-------|
| Image | `redis:7-alpine` |
| Container name | `redis` |
| Internal port | `6379` |
| Host port | not exposed |
| Password | see `.env` (`REDIS_PASSWORD`) |
| Persistence | AOF (append-only file) enabled |
| Max memory | `512mb` |
| Eviction policy | `allkeys-lru` |
| Data volume | `./redis/data → /data` |
| Restart policy | `unless-stopped` |
| Healthcheck | `redis-cli -a $REDIS_PASSWORD ping` every 10s |

**Connection details for backend:**
- Host: `redis`
- Port: `6379`
- Password: `${REDIS_PASSWORD}`

> 🇻🇳 **Chú thích Redis**:
> - **AOF (Append-Only File)**: mỗi lệnh ghi đều được log ra file. Lúc restart Redis, replay log để khôi phục data. **An toàn hơn** RDB snapshot (RDB chỉ snapshot mỗi vài phút).
> - **`maxmemory 512mb`**: giới hạn RAM Redis dùng. Nếu sắp đầy, sẽ evict (xóa bớt) key theo policy `allkeys-lru` (key ít dùng nhất bị xóa trước).
> - **`allkeys-lru` phù hợp cho cache**. Nếu Redis dùng cho session/queue (data quan trọng) thì nên đổi thành `noeviction` để Redis báo lỗi khi đầy thay vì xóa data.
> - **Use case khuyến nghị cho SMPP**:
>   - Cache số dư/credit của user
>   - Rate limiting (đếm số SMS gửi/giây)
>   - Cache template SMS
>   - Queue tạm cho retry
> - Redis 7 hỗ trợ **Redis Streams**, có thể thay RabbitMQ cho 1 số case đơn giản.

### 5.3 RabbitMQ

| Property | Value |
|----------|-------|
| Image | `rabbitmq:3.13-management-alpine` |
| Container name | `rabbitmq` |
| AMQP port | `5672` (internal only) |
| Management UI port | `15672` (bound to `127.0.0.1`) |
| Default user | `smpp_admin` |
| Default password | see `.env` (`RABBITMQ_PASSWORD`) |
| Erlang cookie | hardcoded in compose (change for production cluster) |
| Data volume | `./rabbitmq/data → /var/lib/rabbitmq` |
| Restart policy | `unless-stopped` |
| Healthcheck | `rabbitmq-diagnostics -q ping` every 30s |

**Connection details for backend:**
- Host: `rabbitmq`
- Port: `5672`
- Username: `smpp_admin`
- Password: `${RABBITMQ_PASSWORD}`
- Virtual host: `/`

**Accessing the Management UI from local machine:**
```bash
ssh -L 15672:127.0.0.1:15672 -i D:\works\tkc-02\.ssh\tamtd tamtd@116.118.2.74
# Then open http://localhost:15672 in browser
```

> 🇻🇳 **Chú thích RabbitMQ**:
> - **Image `management-alpine`**: bao gồm Management UI (web admin) — rất tiện để debug, xem queue, message rate.
> - **2 port**:
>   - `5672` (AMQP) — port app dùng để publish/consume message. Không expose ra internet.
>   - `15672` (Management UI) — bind localhost, dùng SSH tunnel để xem từ browser.
> - **Use case cho SMPP**:
>   - Queue `sms.outbound` — message chờ gửi đi
>   - Queue `sms.delivery_report` — DLR nhận về
>   - Queue `sms.failed` — message gửi fail (dead letter queue)
>   - Tách worker ra nhiều consumer để scale horizontal
> - **Erlang cookie** đang để giá trị placeholder (`smpp_cookie_change_me`). Khi nào cần làm RabbitMQ cluster (nhiều node) thì phải đổi giá trị này thật và tất cả node phải giống nhau.
> - **Healthcheck `start_period: 60s`**: RabbitMQ khởi động chậm (~30-60s lần đầu), nên cho 60s ân hạn trước khi check healthcheck.

---

## 6. Configuration Files / File cấu hình

### 6.1 `~/apps/infrastructure/.env`

```env
# PostgreSQL
POSTGRES_DB=smpp_db
POSTGRES_USER=smpp_user
POSTGRES_PASSWORD=<24-char alphanumeric, no special chars>

# Redis
REDIS_PASSWORD=<24-char alphanumeric>

# RabbitMQ
RABBITMQ_USER=smpp_admin
RABBITMQ_PASSWORD=<24-char alphanumeric>
```

> **File permissions**: `chmod 600 .env`
> **Password generation**: `pwgen -s 24 3` was used to avoid shell-interpretable special characters (`$`, `\`, `"`, `'`, `` ` ``).

> 🇻🇳 **Chú thích về password**:
> - Dùng `pwgen -s 24 3` để sinh 3 password ngẫu nhiên dài 24 ký tự, **không có ký tự đặc biệt**.
> - **Tại sao tránh ký tự đặc biệt?** Trong file `.env`:
>   - `$` → bị Docker interpret là biến môi trường
>   - `\` `"` `'` `` ` `` → escape, gây lỗi parse
>   - Khoảng trắng → cắt password
> - Password 24 ký tự alphanumeric đã có entropy ~143 bits → an toàn tuyệt đối, không cần thêm ký tự đặc biệt.
> - **`.env` chmod 600** = chỉ owner đọc/ghi. Tuyệt đối **KHÔNG commit `.env` vào git**. Thêm vào `.gitignore`.

### 6.2 `~/apps/infrastructure/docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - ./postgres/data:/var/lib/postgresql/data
    networks:
      - infra-net
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 30s

  redis:
    image: redis:7-alpine
    container_name: redis
    restart: unless-stopped
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --appendonly yes
      --maxmemory 512mb
      --maxmemory-policy allkeys-lru
    volumes:
      - ./redis/data:/data
    networks:
      - infra-net
    healthcheck:
      test: ["CMD", "redis-cli", "--no-auth-warning", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s

  rabbitmq:
    image: rabbitmq:3.13-management-alpine
    container_name: rabbitmq
    restart: unless-stopped
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD}
      RABBITMQ_ERLANG_COOKIE: smpp_cookie_change_me
    volumes:
      - ./rabbitmq/data:/var/lib/rabbitmq
    networks:
      - infra-net
    ports:
      - "127.0.0.1:15672:15672"
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 60s

networks:
  infra-net:
    external: true
```

> 🇻🇳 **Chú thích đặc biệt của file**:
> - **`PGDATA: /var/lib/postgresql/data/pgdata`** — đặt subdir bên trong volume để tránh xung đột với file metadata của Docker khi mount.
> - **`networks: infra-net`** — chỉ join 1 network. Docker tự động cho container resolve nhau qua DNS trong cùng network.
> - **`networks: infra-net: external: true`** ở cuối — báo cho Docker Compose: "network này đã tồn tại, đừng tạo mới". Network này được tạo trước bằng `docker network create infra-net`.
> - **Không có `version:` ở đầu file** — Docker Compose v2+ không cần nữa, sẽ warn nếu có.
> - **`command:` của Redis** — override ENTRYPOINT mặc định để truyền nhiều flag config.

---

## 7. Verified Behaviour / Đã được verify

The following has been tested and confirmed working:

| Test | Result |
|------|--------|
| All three containers report `(healthy)` after `docker compose up -d` | ✅ |
| `pg_isready` returns "accepting connections" | ✅ |
| `redis-cli PING` returns `PONG` | ✅ |
| `rabbitmq-diagnostics ping` returns "Ping succeeded" | ✅ |
| Containers resolve each other by DNS name (`postgres`, `redis`, `rabbitmq`) | ✅ |
| `ss -tlnp` shows only `127.0.0.1:15672` listening publicly — DBs not exposed | ✅ |
| Postgres data persists after `docker compose restart` | ✅ |
| Restart policy `unless-stopped` restarts container after `kill -9 1` from inside | ✅ |

> 🇻🇳 **Chú thích test đã làm**:
> - Đã ping qua lại giữa các container thành công, DNS resolve đúng tên.
> - Test bằng `sudo ss -tlnp | grep -E "5432|6379|5672|15672"` chỉ thấy duy nhất `127.0.0.1:15672` — đảm bảo database **không lộ ra internet**.
> - Test restart policy: `docker exec postgres sh -c "kill -9 1"` → container tự lên lại sau ~5-10s. Đây mới là test đúng. Lưu ý: nếu dùng `docker kill postgres` từ ngoài thì Docker hiểu là "manual stop" → KHÔNG restart (đúng theo design).

---

## 8. Application Stack (Planned) / Stack ứng dụng (kế hoạch)

The application is **not yet implemented**. The following is the agreed scope:

### Backend
- **Language/runtime**: Java
- **Framework**: TBD (Spring Boot là mặc định khuyến nghị)
- **SMPP library**: TBD (jSMPP là mặc định khuyến nghị)
- **Required external connections**:
  - PostgreSQL → host `postgres`, port `5432`
  - Redis → host `redis`, port `6379`
  - RabbitMQ → host `rabbitmq`, port `5672`
- **Exposed ports**:
  - HTTP API: `8080` (proxied by Nginx)
  - SMPP listener: `2775` (publicly exposed; UFW rule needed: `sudo ufw allow 2775/tcp`)

### Frontend
- **Framework**: TBD (Next.js / React / Vue)
- **Exposed port**: `3000` (proxied by Nginx)

> 🇻🇳 **Chú thích lựa chọn stack đề xuất**:
> - **Spring Boot 3 + Java 21**: ecosystem giàu, support tốt cho async/queue, integration với Postgres/Redis/RabbitMQ chuẩn (Spring Data JPA, Spring Data Redis, Spring AMQP).
> - **jSMPP** vs **Cloudhopper SMPP**:
>   - jSMPP: API đơn giản, dễ học, được maintain. **Khuyến nghị cho team mới**.
>   - Cloudhopper: performance cao hơn (Twitter dùng), nhưng phức tạp hơn.
> - **Next.js** cho frontend: SSR/SSG built-in, dev experience tốt, deploy dễ.
> - **Java 21** (LTS mới nhất, support đến 2031): có virtual threads, performance tốt, syntax mới (records, pattern matching).

### Application `docker-compose.yml` (template)

This file will live at `~/apps/smpp-app/docker-compose.yml`. Key points:

- Backend joins **both** `infra-net` (to reach data services) and `app-net` (to reach frontend).
- Frontend joins **only** `app-net`.
- `infra-net` is declared `external: true`.
- `app-net` is created locally by this compose file.

```yaml
services:
  backend:
    build:
      context: ./backend
    container_name: smpp-backend
    restart: unless-stopped
    environment:
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: smpp_db
      DB_USER: smpp_user
      DB_PASSWORD: ${POSTGRES_PASSWORD}
      REDIS_HOST: redis
      REDIS_PORT: 6379
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      RABBITMQ_HOST: rabbitmq
      RABBITMQ_PORT: 5672
      RABBITMQ_USER: smpp_admin
      RABBITMQ_PASSWORD: ${RABBITMQ_PASSWORD}
      JAVA_OPTS: "-Xms512m -Xmx2g"
    ports:
      - "127.0.0.1:8080:8080"   # API behind Nginx
      - "2775:2775"              # SMPP listener (public)
    networks:
      - infra-net
      - app-net

  frontend:
    build:
      context: ./frontend
    container_name: smpp-frontend
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    networks:
      - app-net
    depends_on:
      - backend

networks:
  infra-net:
    external: true
  app-net:
    driver: bridge
```

> 🇻🇳 **Chú thích app compose**:
> - **Backend join 2 network**:
>   - `infra-net` để gọi `postgres`, `redis`, `rabbitmq` qua DNS
>   - `app-net` để frontend gọi backend (qua Nginx)
> - **`127.0.0.1:8080:8080`**: API chỉ bind localhost trên host. Nginx (cài trên host, ngoài Docker) sẽ proxy từ `:443/api` → `:8080`. Không expose `:8080` ra internet.
> - **`2775:2775`**: SMPP listener bind tất cả interface (0.0.0.0). Đây là port chính thức của giao thức SMPP, cần expose để client SMPP từ ngoài kết nối vào.
> - **`JAVA_OPTS: "-Xms512m -Xmx2g"`**: Heap size từ 512MB đến 2GB. Điều chỉnh theo RAM thực tế của server.
> - **`.env` của smpp-app**: copy giá trị `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `RABBITMQ_PASSWORD` từ `.env` của infrastructure. **2 file .env riêng biệt**, mỗi stack 1 file.

---

## 9. Operational Commands / Lệnh vận hành

### Start / stop infrastructure
```bash
cd ~/apps/infrastructure

docker compose up -d              # Khởi động (hoặc apply config thay đổi)
docker compose ps                 # Xem status
docker compose logs -f            # Theo dõi log realtime (tất cả service)
docker compose logs -f postgres   # Theo dõi log 1 service
docker compose restart postgres   # Restart 1 service
docker compose down               # Dừng tất cả (xóa container, GIỮ NGUYÊN data)
docker compose down -v            # Dừng và XÓA luôn volume (⚠️ MẤT DATA)
```

### Health checks
```bash
source ~/apps/infrastructure/.env

docker exec postgres pg_isready -U $POSTGRES_USER -d $POSTGRES_DB
docker exec redis redis-cli -a "$REDIS_PASSWORD" PING
docker exec rabbitmq rabbitmq-diagnostics ping
```

### Connecting interactively / Kết nối tương tác
```bash
# Postgres shell
docker exec -it postgres psql -U smpp_user -d smpp_db

# Redis shell
docker exec -it redis redis-cli -a "$REDIS_PASSWORD"

# RabbitMQ admin
docker exec rabbitmq rabbitmqctl status
docker exec rabbitmq rabbitmqctl list_users
docker exec rabbitmq rabbitmqctl list_queues
```

### Network introspection / Kiểm tra network
```bash
docker network inspect infra-net
docker network inspect infra-net --format='{{range .Containers}}{{.Name}} {{.IPv4Address}}{{println}}{{end}}'
```

> 🇻🇳 **Chú thích lệnh hay nhầm**:
> - **`docker compose down`** vs **`docker compose down -v`**:
>   - Không có `-v`: chỉ xóa container, **GIỮ** volume (data còn nguyên)
>   - Có `-v`: xóa luôn volume → **MẤT data**. Chỉ dùng khi cố ý reset.
> - **`docker compose restart`** ≠ **`docker compose up -d`**:
>   - `restart`: restart container hiện có, KHÔNG apply config mới
>   - `up -d`: apply config mới (recreate container nếu config thay đổi)
> - **Sau khi sửa `docker-compose.yml`**: dùng `docker compose up -d` (không phải `restart`).

---

## 10. Backup Strategy / Chiến lược backup

### Script: `~/apps/infrastructure/scripts/backup.sh`

Performs the following daily:

1. PostgreSQL: `pg_dump --clean --if-exists | gzip` → `postgres_<timestamp>.sql.gz`
2. Redis: `BGSAVE`, then `docker cp dump.rdb` → `redis_<timestamp>.rdb.gz`
3. RabbitMQ: `rabbitmqctl export_definitions` → `rabbitmq_def_<timestamp>.json.gz`
4. Deletes backups older than 7 days

### Schedule
```cron
0 2 * * * /home/tamtd/apps/infrastructure/scripts/backup.sh >> /home/tamtd/apps/infrastructure/backup/backup.log 2>&1
```

### Restore (PostgreSQL example)
```bash
LATEST=$(ls -t ~/apps/infrastructure/backup/postgres_*.sql.gz | head -1)
gunzip -c "$LATEST" | docker exec -i postgres psql -U smpp_user -d smpp_db
```

> 🇻🇳 **Chú thích backup**:
> - **`pg_dump --clean --if-exists`**: tạo dump file có lệnh `DROP TABLE IF EXISTS` ở đầu → restore an toàn không bị conflict với data cũ.
> - **Redis BGSAVE**: snapshot bất đồng bộ, không block Redis. Có AOF rồi nhưng vẫn backup RDB cho chắc.
> - **RabbitMQ chỉ backup definitions** (queues, exchanges, bindings, users) — KHÔNG backup messages. Messages là transient, mất là OK. Nếu cần persistent message → set `durable: true` trong code.
> - **Cron 2 AM**: chọn giờ thấp điểm. Đổi giờ tùy ý.
> - **Giữ 7 ngày**: cân bằng giữa dung lượng và lịch sử. Nếu cần lâu hơn → đổi `KEEP_DAYS=30`.
> - **3-2-1 rule**: nên có 3 bản backup, 2 loại media khác nhau, 1 bản offsite. Backup trên cùng server vẫn rủi ro (server cháy = mất hết). Cân nhắc upload backup lên S3/Backblaze.
> - **Test restore định kỳ**: backup không restore được = vô dụng. Test ít nhất 1 tháng/lần.

---

## 11. Local Development Notes / Ghi chú dev local

When developing the backend/frontend on a local Windows/Mac machine, the developer cannot reach `postgres`, `redis`, or `rabbitmq` over Docker DNS — those names only resolve inside the server's `infra-net`.

**Recommended local development approaches:**

1. **Local infrastructure replica** — Run an identical `docker-compose.yml` on the developer's machine with the same service names. Application config (DB host = `postgres`, etc.) then works unchanged in both environments.

2. **SSH tunnel to the production server** (for read-only debugging only):
   ```bash
   # Tunnel Postgres
   ssh -L 5432:127.0.0.1:5432 tamtd@116.118.2.74
   # But note: Postgres is NOT exposed on 127.0.0.1 by default —
   # the compose file must be modified to add `ports: ["127.0.0.1:5432:5432"]`.
   ```

3. **Environment-aware configuration** — Backend reads connection details from environment variables (`DB_HOST`, `DB_PORT`, etc.), allowing each environment to override.

The recommended path is approach 1 plus environment variables. The provided `docker-compose.yml` will run on a developer laptop unchanged after `docker network create infra-net`.

> 🇻🇳 **Chú thích dev local (RẤT QUAN TRỌNG)**:
> - **Cách 1 (khuyến nghị)**: máy local cũng cài Docker, chạy `docker-compose.yml` y hệt. App connect đến `postgres`, `redis`, `rabbitmq` qua DNS trong Docker network local. Code chạy được trên máy local là **đảm bảo chạy được trên server**.
> - **Cách 2 (chỉ dùng debug)**: SSH tunnel để connect trực tiếp DB production từ máy local. **CỰC KỲ NGUY HIỂM** nếu vô tình chạy migration/delete script trên DB production. Chỉ dùng để query SELECT.
> - **Cách 3 (best practice)**: code đọc config từ ENV var, không hardcode. Cùng 1 codebase chạy được dev/staging/production chỉ bằng đổi `.env`.
> - **Khuyến nghị nhất**: **Cách 1 + Cách 3** kết hợp.
> - Khi dev local, nên **bind port DB ra localhost** để dùng tools như DBeaver/TablePlus xem data:
>   ```yaml
>   postgres:
>     ports:
>       - "127.0.0.1:5432:5432"   # Chỉ ở dev, không apply lên production
>   ```

---

## 12. Open Items / Việc cần làm tiếp

- [ ] Backup script created and tested (`backup.sh`, `crontab` entry)
- [ ] Backend Dockerfile and source skeleton
- [ ] Frontend Dockerfile and source skeleton
- [ ] `~/apps/smpp-app/docker-compose.yml` finalized
- [ ] Nginx reverse proxy + Let's Encrypt TLS
- [ ] Domain name pointed to `116.118.2.74`
- [ ] UFW rule for SMPP port `2775`
- [ ] Application logging strategy (centralized vs. per-container)
- [ ] Monitoring (Netdata / Prometheus / Grafana)
- [ ] Production secrets management (move away from plain-text `.env`)

> 🇻🇳 **Chú thích thứ tự ưu tiên**:
> - **P0 (làm ngay)**: backup script + cron, scaffold backend + frontend skeleton.
> - **P1 (trước go-live)**: Nginx + SSL, domain, UFW mở port 2775.
> - **P2 (sau MVP)**: monitoring, secrets management (Vault/Doppler).
> - **Logging**: bước đầu cứ dùng `docker logs`, sau này lên centralized logging (Loki + Grafana hoặc ELK).

---

## 13. Reference / Tài liệu tham khảo

- PostgreSQL 16 docs: https://www.postgresql.org/docs/16/
- Redis 7 docs: https://redis.io/docs/
- RabbitMQ 3.13 docs: https://www.rabbitmq.com/documentation.html
- Docker Compose spec: https://docs.docker.com/compose/compose-file/
- jSMPP: https://github.com/opentelecoms-org/jsmpp
- SMPP 3.4 spec: https://smpp.org/SMPP_v3_4_Issue1_2.pdf
- Spring Boot Reference: https://docs.spring.io/spring-boot/docs/current/reference/html/
- Next.js docs: https://nextjs.org/docs

> 🇻🇳 **Chú thích tài liệu nên đọc trước khi code**:
> - **SMPP 3.4 spec**: bắt buộc đọc qua trước khi code SMPP server. Đặc biệt phần PDU format, session states.
> - **jSMPP examples**: xem `gateway-server` example trong repo jSMPP để hiểu cách viết SMPP server.
> - **Spring AMQP**: nếu dùng Spring Boot, dùng `spring-boot-starter-amqp` cho RabbitMQ → tích hợp sẵn, không phải lo connection pool.
