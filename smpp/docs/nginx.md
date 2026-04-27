# Nginx — Reverse Proxy + TLS

Nginx chạy **trên host server** (không trong Docker). Vai trò: TLS termination, reverse proxy tới container `smpp-server` và `frontend`, rate-limit cho API public.

---

## 1. Tại sao chạy trên host (không Docker)

- TLS cert (Let's Encrypt) quản qua `certbot` đặt cert vào `/etc/letsencrypt/live/<domain>/`. Mount vào container phức tạp + cert renew cần reload container.
- Nginx host có thể proxy tới `127.0.0.1:8080` (port container đã bind chỉ tới loopback) — đơn giản, không cần `docker exec`.
- 1 instance Nginx phục vụ nhiều app (nếu sau này có app thứ 2 cùng server) thay vì mỗi app 1 nginx container.

---

## 2. Repo layout

```
smpp/nginx/
├── README.md                 # cách cài + trigger deploy
├── conf.d/
│   └── smpp-app.conf         # vhost chính
├── snippets/
│   ├── ssl-params.conf       # TLS protocols, ciphers, HSTS, OCSP stapling
│   └── proxy-params.conf     # proxy_set_header, timeouts, buffering
└── deploy.sh                 # rsync + nginx -t + systemctl reload
```

---

## 3. `conf.d/smpp-app.conf`

```nginx
# --- Rate limit zones (đặt trong http context, định nghĩa ở /etc/nginx/conf.d/00-zones.conf) ---
# limit_req_zone $binary_remote_addr zone=partner_api:10m rate=100r/s;
# (Đặt trong file 00-zones.conf riêng để tránh redeclare khi nhiều vhost)

# HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name gw.example.com;

    # Cho phép certbot HTTP-01 challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS main vhost
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name gw.example.com;

    ssl_certificate     /etc/letsencrypt/live/gw.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/gw.example.com/privkey.pem;

    include /etc/nginx/snippets/ssl-params.conf;
    include /etc/nginx/snippets/proxy-params.conf;

    # Logs
    access_log /var/log/nginx/smpp-app.access.log;
    error_log  /var/log/nginx/smpp-app.error.log warn;

    # Body limit (SMS body nhỏ, không cần lớn)
    client_max_body_size 1m;

    # Block actuator + internal endpoints
    location ~* ^/(actuator|api/internal)/ {
        return 404;
    }

    # Partner inbound API — rate limited
    location /api/v1/ {
        limit_req zone=partner_api burst=200 nodelay;
        limit_req_status 429;

        proxy_pass http://127.0.0.1:8080;
    }

    # Admin/Portal API
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
    }

    # NextAuth + frontend
    location / {
        proxy_pass http://127.0.0.1:3000;

        # WebSocket / SSE (Next.js dev HMR + future event stream)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

---

## 4. `snippets/ssl-params.conf`

```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384';
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;

# OCSP stapling
ssl_stapling on;
ssl_stapling_verify on;
resolver 1.1.1.1 8.8.8.8 valid=300s;
resolver_timeout 5s;

# HSTS (6 tháng, includeSubDomains chỉ thêm khi đã chắc tất cả sub là HTTPS)
add_header Strict-Transport-Security "max-age=15768000" always;

# Misc security headers
add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" always;
```

---

## 5. `snippets/proxy-params.conf`

```nginx
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Port $server_port;

# Timeouts
proxy_connect_timeout 5s;
proxy_send_timeout    60s;
proxy_read_timeout    60s;

# Buffering
proxy_buffering on;
proxy_buffer_size 16k;
proxy_buffers 4 32k;

# Don't fail on slow upstream
proxy_next_upstream off;
```

---

## 6. WebSocket upgrade map

Cần map `$connection_upgrade` ở `/etc/nginx/conf.d/00-maps.conf`:
```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

---

## 7. Rate limit zones

`/etc/nginx/conf.d/00-zones.conf`:
```nginx
limit_req_zone $binary_remote_addr zone=partner_api:10m rate=100r/s;
limit_req_zone $binary_remote_addr zone=admin_login:10m rate=5r/s;
```

(Có thể cần thêm vào `smpp-app.conf` rule `limit_req zone=admin_login burst=10 nodelay;` cho `/api/admin/auth/login` để chống brute-force.)

---

## 8. TLS — Let's Encrypt qua certbot

### 8.1 Cài đặt (one-time)

```bash
sudo apt install certbot python3-certbot-nginx
sudo mkdir -p /var/www/certbot
sudo certbot --nginx -d gw.example.com --email admin@example.com --agree-tos --no-eff-email
```

Certbot tự động:
- Verify HTTP-01 qua `.well-known/acme-challenge`.
- Tạo cert + key trong `/etc/letsencrypt/live/gw.example.com/`.
- Cài systemd timer `certbot.timer` cho auto-renew.

### 8.2 Auto-renew

Mặc định `certbot.timer` chạy 2 lần/ngày, gia hạn nếu cert <30 ngày tới hạn. Reload nginx hook:

`/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh`:
```bash
#!/bin/bash
systemctl reload nginx
```

```bash
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
```

### 8.3 Verify

```bash
sudo certbot certificates
sudo certbot renew --dry-run
```

---

## 9. UFW firewall

Mở port cần thiết (one-time):
```bash
sudo ufw allow 80/tcp comment 'HTTP redirect + ACME'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw allow 2775/tcp comment 'SMPP server'
sudo ufw status
```

KHÔNG mở:
- 5432 (Postgres)
- 6379 (Redis)
- 5672 (RabbitMQ AMQP)
- 15672 (RabbitMQ UI — chỉ qua SSH tunnel)
- 8080 (BE HTTP — đã chỉ bind 127.0.0.1)
- 3000 (FE — đã chỉ bind 127.0.0.1)

---

## 10. `deploy.sh`

```bash
#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${DOMAIN:-gw.example.com}"
SSH_TARGET="${SSH_TARGET:-tamtd@116.118.2.74}"
SSH_KEY="${SSH_KEY:-D:/works/tkc-02/.ssh/tamtd}"

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[1/4] Sync conf.d & snippets..."
rsync -avz -e "ssh -i $SSH_KEY" \
    "$REPO_DIR/conf.d/" "$SSH_TARGET:/tmp/nginx-conf.d/"
rsync -avz -e "ssh -i $SSH_KEY" \
    "$REPO_DIR/snippets/" "$SSH_TARGET:/tmp/nginx-snippets/"

echo "[2/4] Install on server (sudo cp)..."
ssh -i "$SSH_KEY" "$SSH_TARGET" '
    sudo cp /tmp/nginx-conf.d/*.conf /etc/nginx/conf.d/
    sudo cp /tmp/nginx-snippets/*.conf /etc/nginx/snippets/
'

echo "[3/4] Test config..."
ssh -i "$SSH_KEY" "$SSH_TARGET" 'sudo nginx -t'

echo "[4/4] Reload nginx..."
ssh -i "$SSH_KEY" "$SSH_TARGET" 'sudo systemctl reload nginx'

echo "Done. Visit https://$DOMAIN/"
```

Run:
```bash
cd smpp/nginx
bash deploy.sh
```

Rollback: `git checkout <prev-sha> -- conf.d/ snippets/ && bash deploy.sh`.

---

## 11. README cho repo

`smpp/nginx/README.md` (skeleton):

```markdown
# Nginx config — SMPP gateway

## Bootstrap (one-time per server)

1. `sudo apt install nginx certbot python3-certbot-nginx`
2. `sudo cp 00-maps.conf 00-zones.conf /etc/nginx/conf.d/`
3. `bash deploy.sh` (sync vhost lần đầu — cert chưa có nên có thể fail TLS, sửa tạm `listen 443` → `listen 80`).
4. `sudo certbot --nginx -d gw.example.com`
5. Set DNS A record gw.example.com → 116.118.2.74
6. UFW: `sudo ufw allow 80,443,2775/tcp`
7. `bash deploy.sh` lần 2 (lúc này TLS cert đã có).

## Update conf

Edit `conf.d/smpp-app.conf` hoặc `snippets/*.conf`, commit, `bash deploy.sh`.

## Logs

```
sudo tail -f /var/log/nginx/smpp-app.access.log
sudo tail -f /var/log/nginx/smpp-app.error.log
```

## Cert renew test

`sudo certbot renew --dry-run`
```

---

## 12. Operational tips

- **Reload safely**: Nginx graceful reload (`systemctl reload`) không drop connection. KHÔNG dùng `restart` trừ khi đổi worker_processes/listen.
- **Test config trước reload**: `sudo nginx -t` luôn chạy trước. `deploy.sh` đã tích hợp.
- **Watch logs sau deploy**: `tail -f /var/log/nginx/error.log` 5 phút.
- **Disable HTTP/2 nếu nghi vấn bug**: thay `listen 443 ssl http2` → `listen 443 ssl`.

---

## 13. SMPP port (2775)

SMPP **không qua Nginx** vì:
- TCP raw protocol, không phải HTTP.
- SSL termination cần stunnel hoặc Nginx stream module (phức tạp hơn HTTPS).

Phase 1: SMPP plain TCP, port 2775 expose trực tiếp từ container `smpp-server` ra host (đã mô tả trong `infras.md`).

Phase tương lai có thể thêm Nginx stream module:
```nginx
stream {
    server {
        listen 3550 ssl;        # SMPP over TLS port chuẩn
        proxy_pass 127.0.0.1:2775;
        ssl_certificate /etc/letsencrypt/live/gw.example.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/gw.example.com/privkey.pem;
    }
}
```

Ghi vào ADR mới khi triển khai.

---

## 14. Phase 1 simplification

Phase 1 (chưa có domain) có thể:
- Skip Let's Encrypt → dùng self-signed cert cho dev (`/etc/ssl/private/...`).
- Skip vhost SSL → chỉ HTTP port 80 (KHÔNG public, chỉ test local).
- Mọi config trong repo vẫn nguyên cho prod.

Phase 10 (deploy thật): mua domain → DNS → run full setup ở section 8-11.
