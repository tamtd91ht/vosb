# Data Model — PostgreSQL Schema

8 bảng + Flyway migration. Mọi cột UTC timestamp dùng `TIMESTAMPTZ`. ID partner/channel/route dùng `BIGSERIAL`. Message ID dùng `UUID` (cần unique giữa nhiều worker, không cần sequential).

---

## 1. ERD (ASCII)

```
┌──────────────────┐        ┌──────────────────────────┐
│     partner      │1──────*│  partner_smpp_account    │
│  id (PK)         │        │  id (PK)                 │
│  code UQ         │        │  partner_id (FK)         │
│  name            │        │  system_id UQ            │
│  status          │        │  password_hash (bcrypt)  │
│  dlr_webhook_url │        │  max_binds               │
│  balance         │        │  ip_whitelist (jsonb)    │
│  created_at      │        └──────────────────────────┘
└────────┬─────────┘
         │1─────────*┌──────────────────────────┐
         │           │   partner_api_key        │
         │           │  id (PK)                 │
         │           │  partner_id (FK)         │
         │           │  key_id UQ               │
         │           │  secret_hash (bcrypt)    │
         │           │  status                  │
         │           │  last_used_at            │
         │           └──────────────────────────┘
         │
         │1────*┌────────────────────────┐
         │      │        route           │
         │      │  id (PK)               │
         │      │  partner_id (FK)       │*──────────────────┐
         │      │  msisdn_prefix         │                   │
         │      │  channel_id (FK)       │*─────┐            │
         │      │  priority              │      │            │
         │      │  fallback_channel_id   │*─┐   │            │
         │      │  enabled               │  │   │            │
         │      └────────────────────────┘  │   │            │
         │                                  │   │            │
         │                              ┌───┼───┼──────┐     │
         │                              │   │   │      │     │
         │                              │ ┌─▼───▼──┐   │     │
         │                              │ │channel │   │     │
         │                              │ │id (PK) │   │     │
         │                              │ │code UQ │   │     │
         │                              │ │type    │   │     │
         │                              │ │config  │   │     │
         │                              │ │status  │   │     │
         │                              │ └────────┘   │     │
         │1─────────────────────────────────────────*──┘─────┘
         │                                       *
         │                                  ┌────▼─────────────┐
         │                                  │     message      │
         │                                  │  id (UUID PK)    │
         │                                  │  partner_id (FK) │
         │                                  │  channel_id (FK) │
         │                                  │  source_addr     │
         │                                  │  dest_addr       │
         │                                  │  content         │
         │                                  │  encoding        │
         │                                  │  state           │
         │                                  │  message_id_telco│
         │                                  │  created_at      │
         │                                  │  updated_at      │
         │                                  └────────┬─────────┘
         │                                           │1
         │                                           │
         │                                           │*
         │                                  ┌────────▼─────────┐
         │                                  │       dlr        │
         │                                  │  id (PK)         │
         │                                  │  message_id (FK) │
         │                                  │  state           │
         │                                  │  error_code      │
         │                                  │  raw_payload     │
         │                                  │  received_at     │
         │                                  └──────────────────┘

┌────────────────┐
│   admin_user   │     (độc lập, dành cho login admin/portal viewer)
│  id (PK)       │
│  username UQ   │
│  password_hash │
│  role          │
│  partner_id    │  ← null nếu role=ADMIN, set nếu role=PARTNER
│  enabled       │
└────────────────┘
```

Quan hệ:
- `partner` 1—* `partner_smpp_account`, `partner_api_key`, `route`, `message`, `admin_user`
- `channel` 1—* `route` (qua `channel_id` và `fallback_channel_id`)
- `channel` 1—* `message`
- `message` 1—* `dlr`

---

## 2. Bảng chi tiết

### 2.1 `partner`

```sql
CREATE TABLE partner (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(64) NOT NULL UNIQUE,
    name            VARCHAR(255) NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE/SUSPENDED
    dlr_webhook_url VARCHAR(512),                            -- nullable, dùng nếu không có SMPP session
    balance         NUMERIC(18, 4) NOT NULL DEFAULT 0,       -- VND, billing thủ công phase 1
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_partner_status ON partner(status);
```

Lý do: `code` để admin xác định partner (vd `VIETTEL_INFO`), `name` cho UI hiển thị. `dlr_webhook_url` cho fallback DLR. `balance` chỉ là display (không trừ tự động phase 1).

### 2.2 `partner_smpp_account`

```sql
CREATE TABLE partner_smpp_account (
    id              BIGSERIAL PRIMARY KEY,
    partner_id      BIGINT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
    system_id       VARCHAR(16) NOT NULL UNIQUE,             -- giới hạn SMPP 3.4: ≤16 chars
    password_hash   VARCHAR(72) NOT NULL,                    -- bcrypt 60 char + buffer
    max_binds       INT NOT NULL DEFAULT 5,
    ip_whitelist    JSONB NOT NULL DEFAULT '[]'::jsonb,      -- array of CIDR string
    status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_smpp_account_partner ON partner_smpp_account(partner_id);
```

Lý do: 1 partner có thể nhiều `system_id` (vd partner muốn tách production/test). `password_hash` lưu bcrypt — verify cost ~10 (~30ms). `ip_whitelist` dạng JSON array CIDR để admin nhập linh hoạt; `[]` nghĩa là không whitelist (cho phép mọi IP).

### 2.3 `partner_api_key`

```sql
CREATE TABLE partner_api_key (
    id              BIGSERIAL PRIMARY KEY,
    partner_id      BIGINT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
    key_id          VARCHAR(32) NOT NULL UNIQUE,             -- public id (vd "ak_live_xxxx")
    secret_hash     VARCHAR(72) NOT NULL,                    -- bcrypt(plaintext_secret)
    status          VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE/REVOKED
    label           VARCHAR(64),                              -- "production server 1"
    last_used_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_api_key_partner ON partner_api_key(partner_id);
```

Lý do: secret chỉ hiện 1 lần khi tạo (UI), sau đó chỉ lưu hash. `key_id` clear text dùng để partner identify trong header, server lookup bcrypt.

### 2.4 `channel`

```sql
CREATE TABLE channel (
    id          BIGSERIAL PRIMARY KEY,
    code        VARCHAR(64) NOT NULL UNIQUE,
    name        VARCHAR(255) NOT NULL,
    type        VARCHAR(32) NOT NULL,            -- HTTP_THIRD_PARTY/FREESWITCH_ESL/TELCO_SMPP
    config      JSONB NOT NULL,                  -- schema theo type, xem 2.4.1
    status      VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (type IN ('HTTP_THIRD_PARTY','FREESWITCH_ESL','TELCO_SMPP'))
);
CREATE INDEX idx_channel_type_status ON channel(type, status);
```

#### 2.4.1 Schema `config` jsonb theo `type`

`HTTP_THIRD_PARTY`:
```json
{
  "url": "https://3rdparty.example.com/sms/send",
  "method": "POST",
  "headers": { "X-Custom": "value" },
  "auth_type": "BEARER" | "BASIC" | "HMAC" | "NONE",
  "auth_token": "<plaintext>",            // nếu BEARER/BASIC
  "signing_secret": "<plaintext>",        // nếu HMAC
  "body_template": "<freemarker template>", // optional, default JSON map
  "timeout_ms": 10000
}
```

`FREESWITCH_ESL`:
```json
{
  "host": "freeswitch.internal",
  "port": 8021,
  "password": "<eslpassword>",
  "originate_template": "{originate_str: 'sofia/external/${dest}@gateway1', application: 'playback', data: '/var/sounds/otp_${otp_digits}.wav'}",
  "max_concurrent_calls": 50
}
```

`TELCO_SMPP`:
```json
{
  "host": "smsc.telco.vn",
  "port": 2775,
  "system_id": "myaccount",
  "password": "<plaintext>",
  "system_type": "VMS",
  "bind_type": "TRANSCEIVER",
  "session_count": 2,
  "throughput_per_second": 100,
  "enquire_link_interval_ms": 30000
}
```

Plaintext password trong jsonb là **trade-off phase 1** (chấp nhận DB compromise = telco password lộ). Phase sau encrypt qua `pgcrypto` hoặc Vault. Ghi note vào ADR mới khi triển khai.

### 2.5 `route`

```sql
CREATE TABLE route (
    id                    BIGSERIAL PRIMARY KEY,
    partner_id            BIGINT NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
    msisdn_prefix         VARCHAR(16) NOT NULL,           -- normalized không có '+', vd "8490"
    channel_id            BIGINT NOT NULL REFERENCES channel(id),
    fallback_channel_id   BIGINT REFERENCES channel(id),
    priority              INT NOT NULL DEFAULT 100,
    enabled               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (partner_id, msisdn_prefix, priority)
);
CREATE INDEX idx_route_partner_enabled ON route(partner_id, enabled);
CREATE INDEX idx_route_lookup ON route(partner_id, msisdn_prefix);
```

Match logic (xem `routing.md`):
- Sort theo `priority DESC, length(msisdn_prefix) DESC`.
- `dest_addr.startsWith(msisdn_prefix)` → match.

### 2.6 `message`

```sql
CREATE TABLE message (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    partner_id          BIGINT NOT NULL REFERENCES partner(id),
    channel_id          BIGINT REFERENCES channel(id),         -- null khi state=RECEIVED
    source_addr         VARCHAR(20) NOT NULL,
    dest_addr           VARCHAR(20) NOT NULL,
    content             TEXT NOT NULL,
    encoding            VARCHAR(16) NOT NULL DEFAULT 'GSM7',   -- GSM7/UCS2/LATIN1
    inbound_via         VARCHAR(8) NOT NULL,                    -- SMPP/HTTP
    state               VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
    message_id_telco    VARCHAR(64),                            -- ID từ telco/3rd-party để map DLR
    error_code          VARCHAR(64),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (state IN ('RECEIVED','ROUTED','SUBMITTED','DELIVERED','FAILED'))
);
CREATE INDEX idx_message_partner_created ON message(partner_id, created_at DESC);
CREATE INDEX idx_message_dest ON message(dest_addr);
CREATE INDEX idx_message_telco_id ON message(message_id_telco) WHERE message_id_telco IS NOT NULL;
CREATE INDEX idx_message_state ON message(state) WHERE state IN ('RECEIVED','ROUTED','SUBMITTED');
```

Các index:
- `partner_created` cho query history theo partner (admin/portal).
- `dest` cho filter theo số đích (admin debug).
- `telco_id` partial index để DLR lookup nhanh, chỉ index khi không null.
- `state` partial index cho monitor stuck messages.

### 2.7 `dlr`

```sql
CREATE TABLE dlr (
    id           BIGSERIAL PRIMARY KEY,
    message_id   UUID NOT NULL REFERENCES message(id) ON DELETE CASCADE,
    state        VARCHAR(16) NOT NULL,                  -- DELIVERED/FAILED/EXPIRED/UNKNOWN
    error_code   VARCHAR(64),
    raw_payload  JSONB,                                  -- snapshot gốc (PDU SMPP, JSON webhook, ESL event)
    source       VARCHAR(16) NOT NULL,                   -- TELCO_SMPP/HTTP_WEBHOOK/FREESWITCH_ESL
    received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_dlr_message ON dlr(message_id);
CREATE INDEX idx_dlr_received ON dlr(received_at DESC);
```

Lý do tách bảng (vs cột trong `message`): 1 message có thể nhận nhiều DLR (interim + final), giữ history audit; cũng dễ append-only, không cần lock row `message` mỗi lần DLR đến.

### 2.8 `admin_user`

```sql
CREATE TABLE admin_user (
    id              BIGSERIAL PRIMARY KEY,
    username        VARCHAR(64) NOT NULL UNIQUE,
    password_hash   VARCHAR(72) NOT NULL,                -- bcrypt
    role            VARCHAR(16) NOT NULL,                 -- ADMIN/PARTNER
    partner_id      BIGINT REFERENCES partner(id),        -- null nếu ADMIN, set nếu PARTNER
    enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (role IN ('ADMIN','PARTNER')),
    CHECK ((role = 'ADMIN' AND partner_id IS NULL) OR (role = 'PARTNER' AND partner_id IS NOT NULL))
);
CREATE INDEX idx_admin_user_partner ON admin_user(partner_id);
```

Lý do: cùng bảng login cho cả admin internal và partner portal — đơn giản hóa auth flow. Role + partner_id quyết định vào /admin/* hay /portal/*.

---

## 3. State machine `message.state`

```
        ┌──────────┐  RouteResolver  ┌─────────┐  Dispatcher  ┌───────────┐  DLR  ┌────────────┐
inbound │ RECEIVED │────────────────►│ ROUTED  │─────────────►│ SUBMITTED │──────►│ DELIVERED  │
PDU/HTTP└──────────┘                 └────┬────┘              └─────┬─────┘       └────────────┘
                                          │ all routes fail         │ DLR fail / 5xx
                                          │                         ▼
                                          ▼                   ┌────────────┐
                                    ┌────────┐                │   FAILED   │
                                    │ FAILED │                └────────────┘
                                    └────────┘
```

Transitions hợp lệ:
- `RECEIVED` → `ROUTED` (RouteResolver match)
- `RECEIVED` → `FAILED` (no route match)
- `ROUTED` → `SUBMITTED` (Dispatcher succeeded → external accepted)
- `ROUTED` → `FAILED` (Dispatcher fail + fallback fail)
- `SUBMITTED` → `DELIVERED` (DLR DELIVRD)
- `SUBMITTED` → `FAILED` (DLR FAIL/EXPIRED/REJECTD)

Không cho transition ngược (state monotonic). Worker dùng optimistic locking (`@Version` JPA) để tránh concurrent update.

---

## 4. Flyway migration plan

### V1__init.sql
Tạo cả 8 bảng + index + check constraints. Seed default `admin_user` qua `V900__seed_admin.sql` (Flyway hỗ trợ thứ tự `V1`, `V2`, ..., `V900` cuối — convention "data migration ≥ 900").

### Migrations sau V1 (ví dụ tương lai)
- `V2__add_partner_rate_limit.sql` — thêm cột `partner.rate_limit_per_second`.
- `V3__add_message_segments.sql` — long SMS multi-segment.
- `V4__create_billing_event.sql` — billing detail.

**Quy tắc**: KHÔNG sửa V đã apply. Nếu sai → V mới đảo ngược.

### Repeatable migrations (V → R)
Dành cho view/function. Đặt prefix `R__`, vd `R__view_message_summary.sql`. Flyway re-run khi checksum đổi.

---

## 5. Index strategy tổng quát

- Mọi FK đều có index (Postgres không auto-index FK).
- Index cho query thường xuyên: `partner+created_at`, `dest_addr`.
- Partial index cho `state` (chỉ index hot states).
- Tránh over-indexing bảng `message` (write-heavy): mỗi index thêm 5-10% overhead INSERT.

---

## 6. Retention & archival

Phase 1: giữ tất cả. Phase sau:
- `message`/`dlr` cũ >90 ngày → archive sang table `message_archive` hoặc S3 parquet.
- Job archival chạy hàng đêm (Spring `@Scheduled` hoặc Postgres `pg_cron`).

Note vào ADR mới khi triển khai retention.
