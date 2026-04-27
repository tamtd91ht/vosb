# SMPP Platform - Infrastructure Documentation

> **Purpose**: This document describes the production infrastructure setup for an SMPP server platform. Use this as the source of truth when scaffolding the backend (Java) and frontend source code on a local development machine.

---

## 1. Server Information

| Item | Value |
|------|-------|
| OS | Ubuntu 24.04.4 LTS |
| Kernel | 6.8.0-110-generic |
| Public IP | `116.118.2.74` |
| Hostname | `vt` |
| Architecture | x86_64 |
| Timezone | Asia/Ho_Chi_Minh |

### Access

- SSH user: `tamtd` (sudo enabled, password locked for root)
- SSH port: `22`
- SSH authentication: **Public key only** (password authentication disabled)
- Private key path on local Windows: `D:\works\tkc-02\.ssh\tamtd`
- SSH command: `ssh -i D:\works\tkc-02\.ssh\tamtd tamtd@116.118.2.74`

### Security Hardening Applied

- UFW firewall: enabled, default deny incoming, allow port 22 only
- Fail2ban: active on `sshd` jail (bantime 1h, maxretry 3, findtime 10m)
- SSH: `PermitRootLogin no`, `PasswordAuthentication no`, `PubkeyAuthentication yes`
- Root account: password locked (`passwd -l root`)
- Auto security updates: `unattended-upgrades` enabled

---

## 2. Architecture Overview

The deployment is split into two independent stacks:

```
~/apps/
├── infrastructure/      ← Stateful services (DB, cache, MQ)
└── smpp-app/            ← Stateless application code (BE, FE)
```

The two stacks communicate over a shared Docker network (`infra-net`) declared as `external` in each `docker-compose.yml`. This separation lets the application be redeployed without affecting infrastructure data, and allows future apps to share the same infrastructure.

### Network Topology

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
                                  Backend also joins
                                  infra-net to reach
                                  data services
                                          │
                  ┌───────────────────────┼──────────────────┐
                  │                       │                  │
            ┌─────▼─────┐          ┌──────▼──────┐    ┌──────▼──────┐
            │ postgres  │          │    redis    │    │  rabbitmq   │
            │   :5432   │          │    :6379    │    │   :5672     │
            └───────────┘          └─────────────┘    └─────────────┘
                                          infra-net
```

**Key invariants:**
- PostgreSQL (5432), Redis (6379), and RabbitMQ AMQP (5672) are **never** exposed on the host.
- RabbitMQ Management UI (15672) is bound to `127.0.0.1` only — accessible via SSH tunnel.
- The SMPP listener port (planned: 2775) is the only application port intentionally exposed publicly besides 80/443.

---

## 3. Directory Layout

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
    ├── backend/                  # Java backend (to be scaffolded)
    ├── frontend/                 # Frontend (to be scaffolded)
    └── nginx/                    # Reverse proxy config (TBD)
```

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

---

## 5. Infrastructure Services

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

---

## 6. Configuration Files

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

---

## 7. Verified Behaviour

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

---

## 8. Application Stack (Planned)

The application is **not yet implemented**. The following is the agreed scope:

### Backend
- **Language/runtime**: Java
- **Framework**: TBD (Spring Boot is the default recommendation)
- **SMPP library**: TBD (jSMPP is the default recommendation)
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

---

## 9. Operational Commands

### Start / stop infrastructure
```bash
cd ~/apps/infrastructure

docker compose up -d              # Start (or apply config changes)
docker compose ps                 # Check status
docker compose logs -f            # Follow logs (all services)
docker compose logs -f postgres   # Follow logs (one service)
docker compose restart postgres   # Restart one service
docker compose down               # Stop all (containers removed, data preserved)
docker compose down -v            # Stop and remove volumes (⚠️ DATA LOSS)
```

### Health checks
```bash
source ~/apps/infrastructure/.env

docker exec postgres pg_isready -U $POSTGRES_USER -d $POSTGRES_DB
docker exec redis redis-cli -a "$REDIS_PASSWORD" PING
docker exec rabbitmq rabbitmq-diagnostics ping
```

### Connecting interactively
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

### Network introspection
```bash
docker network inspect infra-net
docker network inspect infra-net --format='{{range .Containers}}{{.Name}} {{.IPv4Address}}{{println}}{{end}}'
```

---

## 10. Backup Strategy

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

---

## 11. Local Development Notes

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

---

## 12. Open Items

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

---

## 13. Reference

- PostgreSQL 16 docs: https://www.postgresql.org/docs/16/
- Redis 7 docs: https://redis.io/docs/
- RabbitMQ 3.13 docs: https://www.rabbitmq.com/documentation.html
- Docker Compose spec: https://docs.docker.com/compose/compose-file/
- jSMPP: https://github.com/opentelecoms-org/jsmpp
