# REST API Spec

3 nhóm endpoint, mount qua **Vert.x Web sub-router** riêng (mỗi router có `AuthenticationHandler` riêng — xem ADR-010 và `.claude/rules/vertx-rest.md`). Tất cả response JSON. Error format **RFC 7807** (`application/problem+json`) qua `failureHandler` chung.

| Nhóm | Path prefix | Auth | Audience |
|---|---|---|---|
| Partner inbound | `/api/v1/*` | API key + HMAC | Đối tác (server-to-server) |
| Admin | `/api/admin/*` | Bearer JWT, role=ADMIN | Operator nội bộ qua web UI |
| Portal | `/api/portal/*` | Bearer JWT, role=PARTNER | Đối tác qua web UI |

Internal endpoint (DLR webhook nhận từ 3rd-party) đặt path `/api/internal/*` — auth bằng IP whitelist hoặc shared secret riêng (config trong `channel.config`).

---

## 1. Authentication

### 1.1 Partner inbound — API key + HMAC

Headers bắt buộc:
- `X-Api-Key`: `key_id` (clear text, vd `ak_live_abc123`)
- `X-Timestamp`: Unix epoch seconds (UTC). Server reject nếu lệch >5 phút (config `app.hmac.timestamp-skew`).
- `X-Signature`: hex-lowercase của `HMAC-SHA256(secret, message)` trong đó:
  ```
  message = METHOD + "\n" + REQUEST_PATH + "\n" + X-Timestamp + "\n" + RAW_BODY
  ```

Server flow:
1. Lookup `partner_api_key` theo `X-Api-Key`. Nếu không tồn tại hoặc `status=REVOKED` → 401.
2. Verify timestamp skew.
3. Replay protection: Redis SETNX `hmac:replay:<sig>` value=1 EX 600. Nếu key đã tồn tại → 401.
4. Lấy plaintext secret: bcrypt KHÔNG reverse được → cần lưu plaintext? **Quyết định**: lưu `secret_hash = bcrypt(secret)`, KHÔNG lưu plaintext. Server verify bằng cách: rebuild HMAC với mọi candidate secret? Không khả thi.
   - **Phương án thực tế**: lưu `secret_encrypted` (AES-GCM) thay vì bcrypt. Key AES nằm trong env `APP_SECRET_KEY`. Server decrypt → HMAC verify.
   - **Note**: cập nhật ADR + `data-model.md` (sửa tên cột `secret_hash` → `secret_encrypted` ở phase 4 implement). Phase 1 docs giữ tên `secret_hash` để tránh confusion, sẽ rename khi implement.
5. Update `partner_api_key.last_used_at = NOW()` (async, batch update mỗi 10s).

Ví dụ curl:
```bash
TS=$(date +%s)
BODY='{"source_addr":"VHT","dest_addr":"84901234567","content":"hello"}'
SIG=$(printf "POST\n/api/v1/messages\n%s\n%s" "$TS" "$BODY" \
      | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $2}')

curl -X POST https://gw.example.com/api/v1/messages \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $KEY_ID" \
  -H "X-Timestamp: $TS" \
  -H "X-Signature: $SIG" \
  -d "$BODY"
```

### 1.2 Admin / Portal — Bearer JWT

Login flow:
- `POST /api/admin/auth/login` (cũng dùng cho portal, role được lookup từ DB) body `{ username, password }` → 200 `{ access_token, refresh_token, expires_in, role, partner_id? }`.
- `POST /api/admin/auth/refresh` body `{ refresh_token }` → access_token mới.
- `POST /api/admin/auth/logout` → revoke refresh_token (Redis blacklist).

Authenticated request:
- Header `Authorization: Bearer <access_token>`.
- JWT claims: `sub` (admin_user.id), `role` (ADMIN/PARTNER), `partner_id` (nullable), `exp`.
- TTL: access 1h, refresh 30d (config `app.jwt.access-ttl`, `app.jwt.refresh-ttl`).
- Storage FE: cookie httpOnly + SameSite=Strict (NextAuth quản).

---

## 2. Partner inbound endpoints — `/api/v1/*`

### 2.1 `POST /api/v1/messages` — gửi 1 message

Request body:
```json
{
  "source_addr": "VHT",                    // sender ID, ≤11 chars alpha hoặc ≤15 digits
  "dest_addr": "84901234567",              // E.164 không có '+' (server normalize)
  "content": "Hello world",                 // ≤ 160 GSM7 hoặc ≤ 70 UCS2 (phase 1 single-segment)
  "encoding": "GSM7",                       // GSM7 | UCS2 | LATIN1, default GSM7
  "type": "SMS",                            // SMS | VOICE_OTP, default SMS
  "voice_otp_digits": "123456",             // bắt buộc nếu type=VOICE_OTP
  "callback_url": "https://partner.example.com/dlr",  // optional, override partner.dlr_webhook_url
  "client_ref": "partner-internal-id-1234"  // optional, partner-side ref, lưu trong message metadata
}
```

Response 202:
```json
{
  "message_id": "01HZ8K3M9X8Q...",          // UUID hoặc Crockford base32
  "status": "ACCEPTED",
  "created_at": "2026-04-27T08:30:00Z"
}
```

Response 400 (validation):
```json
{
  "type": "https://gw.example.com/errors/validation",
  "title": "Bad Request",
  "status": 400,
  "detail": "dest_addr must be 9-15 digits",
  "errors": [{ "field": "dest_addr", "message": "must match E.164 format" }]
}
```

Response 401: HMAC sai/timestamp lệch.
Response 422: business reject (no route, partner suspended).
Response 429: rate limit (429 + `Retry-After` header).

### 2.2 `GET /api/v1/messages/{id}` — query trạng thái

Response 200:
```json
{
  "message_id": "01HZ...",
  "state": "DELIVERED",                     // RECEIVED/ROUTED/SUBMITTED/DELIVERED/FAILED
  "source_addr": "VHT",
  "dest_addr": "84901234567",
  "channel_code": "viettel-smpp",           // null nếu chưa route
  "submitted_at": "2026-04-27T08:30:01Z",
  "delivered_at": "2026-04-27T08:30:08Z",
  "error_code": null,
  "client_ref": "partner-internal-id-1234"
}
```

Partner chỉ thấy message của mình (server filter `WHERE partner_id = <auth>`).

### 2.3 `GET /api/v1/messages` — list/search

Query params:
- `from`, `to`: ISO 8601 timestamp.
- `dest_addr`: số cụ thể.
- `state`: filter state.
- `client_ref`: tìm theo ref.
- `page` (default 0), `size` (default 20, max 100).

Response 200:
```json
{
  "items": [ /* xem 2.2 */ ],
  "page": 0,
  "size": 20,
  "total": 1234
}
```

---

## 3. Admin endpoints — `/api/admin/*`

### 3.1 Auth

- `POST /api/admin/auth/login`
- `POST /api/admin/auth/refresh`
- `POST /api/admin/auth/logout`
- `GET /api/admin/auth/me` → trả info user hiện tại

### 3.2 Partner CRUD

- `GET /api/admin/partners?page=&size=&search=`
- `POST /api/admin/partners` body `{ code, name, dlr_webhook_url? }`
- `GET /api/admin/partners/{id}`
- `PATCH /api/admin/partners/{id}` body partial
- `DELETE /api/admin/partners/{id}` (soft delete: set `status=DELETED` thay vì xóa thật)

### 3.3 Partner SMPP account

- `GET /api/admin/partners/{id}/smpp-accounts`
- `POST /api/admin/partners/{id}/smpp-accounts` body `{ system_id, password, max_binds?, ip_whitelist? }` — server bcrypt password trước khi save, response **không bao giờ** trả password.
- `PATCH /api/admin/smpp-accounts/{id}` (đổi password, ip_whitelist, status)
- `DELETE /api/admin/smpp-accounts/{id}`

### 3.4 Partner API key

- `GET /api/admin/partners/{id}/api-keys`
- `POST /api/admin/partners/{id}/api-keys` body `{ label }` → **response duy nhất 1 lần** chứa plaintext secret:
  ```json
  { "key_id": "ak_live_xxxx", "secret": "sk_live_yyyyyyyy_chỉ_hiện_lần_này", "label": "..." }
  ```
- `POST /api/admin/api-keys/{id}/revoke`

### 3.5 Channel

- `GET /api/admin/channels`
- `POST /api/admin/channels` body `{ code, name, type, config }` — server validate `config` schema theo `type`.
- `GET /api/admin/channels/{id}`
- `PATCH /api/admin/channels/{id}`
- `DELETE /api/admin/channels/{id}`
- `POST /api/admin/channels/{id}/test` → ping kiểm tra (HTTP: HEAD url; SMPP: bind+unbind; ESL: connect+disconnect). Response: `{ ok: true, latency_ms: 125 }` hoặc error.

### 3.6 Route

- `GET /api/admin/routes?partner_id=`
- `POST /api/admin/routes` body `{ partner_id, msisdn_prefix, channel_id, fallback_channel_id?, priority }`
- `PATCH /api/admin/routes/{id}`
- `DELETE /api/admin/routes/{id}`

### 3.7 Message log

- `GET /api/admin/messages?partner_id=&channel_id=&state=&from=&to=&dest_addr=&page=&size=`
- `GET /api/admin/messages/{id}` (kèm DLR history)

### 3.8 Sessions (SMPP active)

- `GET /api/admin/sessions` → list `{ system_id, partner_code, source_ip, bound_at, bind_type }`
- `POST /api/admin/sessions/{system_id}/kick` → unbind tất cả session của `system_id`

### 3.9 Dashboard / metrics

- `GET /api/admin/stats/overview?from=&to=` → `{ total_messages, delivered, failed, by_partner: [...], by_channel: [...] }`
- `GET /api/admin/stats/timeseries?from=&to=&bucket=hour&metric=count` → array `{ ts, value }` cho chart

### 3.10 Admin user (operator)

- `GET /api/admin/users`
- `POST /api/admin/users` body `{ username, password, role, partner_id? }`
- `PATCH /api/admin/users/{id}`

---

## 4. Portal endpoints — `/api/portal/*`

Partner login → JWT có claim `partner_id`. Server tự động filter theo claim này. **KHÔNG** cho client truyền `partner_id` qua param.

### 4.1 Auth (chia sẻ với admin)

- `POST /api/admin/auth/login` (cùng endpoint, role được lookup)
- ... (xem 3.1)

### 4.2 Overview

- `GET /api/portal/overview?from=&to=` → balance + stats summary

### 4.3 Message log

- `GET /api/portal/messages?...` (cùng filter như admin nhưng partner_id ép từ JWT)
- `GET /api/portal/messages/{id}`

### 4.4 API key

- `GET /api/portal/api-keys`
- `POST /api/portal/api-keys` body `{ label }` → hiện secret 1 lần (như admin)
- `POST /api/portal/api-keys/{id}/revoke`

### 4.5 SMPP account

- `GET /api/portal/smpp-accounts` (chỉ readonly cho partner)
- `POST /api/portal/smpp-accounts/{id}/change-password` body `{ new_password }` (partner tự đổi)

### 4.6 Webhook config

- `PATCH /api/portal/webhook` body `{ dlr_webhook_url }` — set DLR webhook URL của chính partner

---

## 5. Internal endpoints — `/api/internal/*`

### 5.1 DLR webhook (3rd-party callback)

- `POST /api/internal/dlr/{channel_id}` body schema do 3rd-party quyết định, server parse theo `channel.config.webhook_payload_format`.
- Auth: shared secret trong header `X-Webhook-Secret` so với `channel.config.webhook_secret`.
- IP whitelist check theo `channel.config.webhook_allowed_ips`.

Response 200 OK với body trống (best practice cho webhook).

---

## 6. Error format chuẩn (RFC 7807)

Tất cả response 4xx/5xx có Content-Type `application/problem+json`:

```json
{
  "type": "https://gw.example.com/errors/validation",   // URI mô tả error type, có thể stable URN
  "title": "Bad Request",                                // human readable, stable per type
  "status": 400,
  "detail": "field 'dest_addr' must match E.164",       // chi tiết instance này
  "instance": "/api/v1/messages",                        // path
  "trace_id": "abc123",                                  // để debug
  "errors": [                                             // optional, mảng field error cho validation
    { "field": "dest_addr", "message": "must match E.164" }
  ]
}
```

Error type chính:
- `validation` (400)
- `unauthorized` (401)
- `forbidden` (403)
- `not_found` (404)
- `conflict` (409) — vd duplicate code
- `rate_limited` (429)
- `business_rejected` (422) — partner suspended, no route, no balance
- `internal_error` (500)

---

## 7. Pagination

Query: `?page=0&size=20&sort=created_at,desc`.

Response chuẩn cho list:
```json
{
  "items": [...],
  "page": 0,
  "size": 20,
  "total": 1234,
  "total_pages": 62
}
```

`size` max 100. Client cần > 100 → dùng `from`/`to` filter chia thành nhiều request.

---

## 8. Versioning

- Path prefix `/api/v1` cho partner API. Khi cần break → `/api/v2` song song.
- Admin/Portal API không versioning (tied chặt với FE cùng repo, deploy đồng bộ).
- Header `X-Api-Version` không bắt buộc gửi (server log nhận biết client version).

---

## 9. Rate limiting

Phase 1: rate limit ở 2 tầng:
1. **Nginx**: zone `partner_api`, 100 req/s/IP cho `/api/v1/*`.
2. **App**: bucket Redis per-partner, default 50 msg/s, override qua `partner.rate_limit_per_second` (cột tương lai, phase 1 chưa có → dùng default).

Khi hit limit → 429 + `Retry-After: <seconds>`.

---

## 10. OpenAPI

Backend dùng `springdoc-openapi-starter-webmvc-ui` để generate OpenAPI 3 spec. Endpoint `/v3/api-docs` (chặn ở Nginx public). Swagger UI ở `/swagger-ui.html` chỉ enable trong profile `dev`.

Phase 1 không bắt buộc maintain OpenAPI thủ công; spec generated từ controller là source of truth.
