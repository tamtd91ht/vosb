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
- `POST /api/admin/auth/login` (cũng dùng cho portal, role được lookup từ DB) body `{ username, password }` → 200 `{ token, refresh_token, expires_in }`.
- `POST /api/admin/auth/refresh` body `{ refresh_token }` → token mới.
- `POST /api/admin/auth/logout` → 204 (blacklist access jti trong Redis `jwt:bl:<jti>`).

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
  "callback_url": "https://partner.example.com/dlr",  // optional, override partner.dlr_webhook
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

**`POST /api/admin/auth/login`**

Request:
```json
{ "username": "admin", "password": "Admin@123456" }
```
Response 200:
```json
{ "token": "eyJ...", "refresh_token": "eyJ...", "expires_in": 3600 }
```
Response 401: sai password hoặc user không tồn tại.

Refresh token được lưu trong Redis key `jwt:refresh:<raw_refresh_token>` EX 30 ngày.

---

**`POST /api/admin/auth/refresh`**

Request:
```json
{ "refresh_token": "eyJ..." }
```
Response 200:
```json
{ "token": "eyJ...", "expires_in": 3600 }
```
Response 401: refresh token không hợp lệ hoặc đã hết hạn.

---

**`POST /api/admin/auth/logout`** — yêu cầu Bearer token

Response 204: blacklist access jti trong Redis `jwt:bl:<jti>` EX remaining_seconds.
Response 401: không có hoặc token không hợp lệ.

---

**`GET /api/admin/auth/me`** — yêu cầu Bearer token

Response 200:
```json
{ "id": 1, "username": "admin", "role": "ADMIN", "partner_id": null }
```
Response 401: thiếu hoặc sai Bearer.

### 3.2 Partner CRUD

- `GET /api/admin/partners?page=0&size=20&status=` → 200 `{ items, total, page, size }`
- `POST /api/admin/partners` body `{ code, name, dlr_webhook? }` → 201 | 400 | 409 (dup code)
- `GET /api/admin/partners/:id` → 200 | 404
- `PUT /api/admin/partners/:id` body `{ name?, status?, dlr_webhook? }` → 200 | 404
- `DELETE /api/admin/partners/:id` → 204 (soft-delete: `status=SUSPENDED`, không xóa thật)

`dlr_webhook` là object JSONB, **không phải** plain URL string:
```json
{ "url": "https://partner.example.com/dlr", "method": "POST", "headers": { "X-Secret": "abc" } }
```

Response PartnerResponse:
```json
{
  "id": 1,
  "code": "PARTNER_A",
  "name": "Partner A",
  "status": "ACTIVE",
  "dlr_webhook": { "url": "...", "method": "POST", "headers": {} },
  "balance": 0,
  "created_at": "2026-04-28T00:00:00Z",
  "updated_at": "2026-04-28T00:00:00Z"
}
```

### 3.3 Partner SMPP account

Tất cả endpoint đặt dưới path `/api/admin/partners/:partnerId/smpp-accounts`.

- `POST /api/admin/partners/:partnerId/smpp-accounts` body `{ system_id, password, max_binds?, ip_whitelist? }` → 201 | 400 | 404 (partner not found) | 409 (dup system_id)
- `GET /api/admin/partners/:partnerId/smpp-accounts` → 200 list
- `GET /api/admin/partners/:partnerId/smpp-accounts/:id` → 200 | 404
- `DELETE /api/admin/partners/:partnerId/smpp-accounts/:id` → 204 (soft-delete: `status=DISABLED`)

Server bcrypt password trước khi save. Response **không bao giờ** trả password field:
```json
{
  "id": 1,
  "partner_id": 1,
  "system_id": "partner_a",
  "max_binds": 5,
  "ip_whitelist": ["1.2.3.4"],
  "status": "ACTIVE",
  "created_at": "2026-04-28T00:00:00Z"
}
```

### 3.4 Partner API key

- `POST /api/admin/partners/:partnerId/api-keys` body `{ label? }` → 201 | 400 | 404
- `GET /api/admin/partners/:partnerId/api-keys` → 200 list
- `DELETE /api/admin/partners/:partnerId/api-keys/:id` → 204 (revoke: `status=REVOKED`)

`POST` response — **raw_secret chỉ hiển thị 1 lần duy nhất** (sau đó không thể lấy lại):
```json
{ "key_id": "ak_live_aBcDeFgH1234", "raw_secret": "base64url_32_random_bytes", "label": "..." }
```

`key_id` format: `ak_live_<16 ký tự alphanumeric>`. `raw_secret` là base64url của 32 random bytes. Secret được lưu trong DB dưới dạng AES-GCM-256 encrypted (`secret_encrypted bytea` + `nonce bytea`).

`GET` response list — không có secret field:
```json
[{ "id": 1, "key_id": "ak_live_...", "label": "...", "status": "ACTIVE", "last_used_at": null, "created_at": "..." }]
```

### 3.5 Channel

- `GET /api/admin/channels?type=&status=&page=&size=` → 200 `{ items, total, page, size }`
- `POST /api/admin/channels` body `{ code, name, type, config }` → 201 | 400 | 409
- `GET /api/admin/channels/:id` → 200 | 404
- `PUT /api/admin/channels/:id` body `{ name?, status?, config? }` → 200 | 404
- `DELETE /api/admin/channels/:id` → 204 (soft-delete: `status=DISABLED`)
- `POST /api/admin/channels/:id/test-ping` → 200 `{ reachable, latency_ms }` hoặc `{ supported: false, message }` (các type chưa implement ping)

Config required fields theo `type`:
- `HTTP_THIRD_PARTY`: `url`, `method`, `auth_type`
- `FREESWITCH_ESL`: `host`, `port`, `password`
- `TELCO_SMPP`: `host`, `port`, `system_id`, `password`

Response ChannelResponse:
```json
{
  "id": 1,
  "code": "viettel-smpp",
  "name": "Viettel SMPP",
  "type": "TELCO_SMPP",
  "config": { "host": "...", "port": 2775, "system_id": "...", "password": "..." },
  "status": "ACTIVE",
  "created_at": "...",
  "updated_at": "..."
}
```

### 3.6 Route

- `GET /api/admin/routes?partner_id=&channel_id=&page=&size=` → 200 `{ items, total, page, size }`
- `POST /api/admin/routes` body (xem bên dưới) → 201 (kèm `warnings` nếu thiếu bảng giá) | 400 | 404 | 409
- `PUT /api/admin/routes/:id` body `{ carrier?, msisdn_prefix?, channel_id?, fallback_channel_id?, priority?, enabled? }` → 200 | 404 | 409
- `DELETE /api/admin/routes/:id` → 204 (soft-delete: `enabled=false`)

**Hai loại định tuyến** (bắt buộc chọn một):

```json
// Theo nhà mạng (carrier route):
{ "partner_id": 1, "carrier": "VIETTEL", "channel_id": 2, "priority": 100 }

// Theo prefix số (prefix route, prefix trống = wildcard):
{ "partner_id": 1, "msisdn_prefix": "8496", "channel_id": 2, "priority": 100 }
```

`carrier` hợp lệ: `VIETTEL`, `MOBIFONE`, `VINAPHONE`, `VIETNAMOBILE`, `GMOBILE`, `REDDI`. Carrier và msisdn_prefix loại trừ nhau — không được gửi cùng lúc.

409: vi phạm unique constraint — mỗi partner chỉ có 1 carrier route per carrier, và unique `(partner_id, msisdn_prefix, priority)` cho prefix route.

`msisdn_prefix` được normalize (strip leading `+`). Trống = wildcard catch-all.

**Response 201 (create)** — thêm `warnings` advisory nếu thiếu bảng giá:
```json
{
  "id": 5,
  "partner_id": 1,
  "carrier": "VIETTEL",
  "msisdn_prefix": "",
  "channel_id": 2,
  "fallback_channel_id": null,
  "priority": 100,
  "enabled": true,
  "created_at": "2026-04-28T10:00:00Z",
  "warnings": [
    "No active partner rate for carrier=VIETTEL — messages will not be billed",
    "No active channel rate for carrier=VIETTEL — provider cost will not be tracked"
  ]
}
```

`warnings` rỗng = rate đã đầy đủ. Warning không block việc tạo route — chỉ advisory.

### 3.11 Channel rates (bảng giá kênh)

Bảng giá kênh = chi phí VOSB trả cho provider. Đặt dưới `/api/admin/channels/:id/rates`.

- `GET /api/admin/channels/:id/rates` → 200 list
- `POST /api/admin/channels/:id/rates` body `{ carrier?, prefix?, rate, currency, unit, effective_from, effective_to? }` → 201
- `PUT /api/admin/channels/:id/rates/:rateId` body `{ rate?, effective_to? }` → 200
- `DELETE /api/admin/channels/:id/rates/:rateId` → 204

`carrier` hoặc `prefix` (exclusive). `prefix = ''` = wildcard default rate.

`unit`: `MESSAGE` (SMS), `SECOND` (Voice OTP), `CALL` (Voice OTP flat per call).

Response ChannelRateResponse:
```json
{
  "id": 1, "channel_id": 2,
  "carrier": "VIETTEL", "prefix": "",
  "rate": 0.0012, "currency": "VND", "unit": "MESSAGE",
  "effective_from": "2026-01-01", "effective_to": null,
  "created_at": "2026-04-28T00:00:00Z"
}
```

### 3.12 Partner rates (bảng giá partner)

Bảng giá partner = doanh thu VOSB thu từ partner. Đặt dưới `/api/admin/partners/:partnerId/rates`.

- `GET /api/admin/partners/:partnerId/rates?delivery_type=SMS|VOICE_OTP` → 200 list
- `POST /api/admin/partners/:partnerId/rates` body `{ delivery_type, carrier?, prefix?, rate, currency, unit, effective_from, effective_to? }` → 201
- `PUT /api/admin/partners/:partnerId/rates/:rateId` body `{ rate?, effective_to? }` → 200
- `DELETE /api/admin/partners/:partnerId/rates/:rateId` → 204

### 3.13 Carriers lookup

- `GET /api/admin/carriers` → 200 list carrier với prefixes

```json
[
  { "code": "VIETTEL", "name": "Viettel", "prefixes": ["8486","8496","8497","8498"] },
  { "code": "MOBIFONE", "name": "MobiFone", "prefixes": ["8470","8479","8489"] }
]
```

### 3.7 Message log

- `GET /api/admin/messages?partner_id=&state=&dest_addr=&page=&size=` → 200 `{ items, total, page, size }` (sorted DESC createdAt)
- `GET /api/admin/messages/:id` → 200 | 400 (invalid UUID) | 404

Response MessageResponse:
```json
{
  "id": "uuid",
  "partner_id": 1,
  "channel_id": 2,
  "source_addr": "VHT",
  "dest_addr": "84901234567",
  "content": "Hello",
  "encoding": "GSM7",
  "inbound_via": "HTTP",
  "state": "DELIVERED",
  "message_id_telco": "...",
  "error_code": null,
  "created_at": "...",
  "updated_at": "..."
}
```

### 3.8 Sessions (SMPP active)

- `GET /api/admin/sessions` → 200 `{ items, total }` — list active SMPP sessions
- `DELETE /api/admin/sessions/:id` → 204 (unbind + close) | 404

Response SessionInfo:
```json
{ "session_id": "uuid", "system_id": "partner_a", "bind_type": "TRANSCEIVER", "remote_ip": "1.2.3.4", "bound_at": "2026-04-28T10:00:00Z" }
```

### 3.9 Dashboard / metrics

**`GET /api/admin/stats/overview`** → 200 map state → count:
```json
{ "RECEIVED": 120, "ROUTED": 118, "SUBMITTED": 115, "DELIVERED": 110, "FAILED": 5 }
```

**`GET /api/admin/stats/timeseries?granularity=hour|day&from=<ISO8601>&to=<ISO8601>`** → 200:
```json
{
  "granularity": "hour",
  "from": "2026-04-28T00:00:00Z",
  "to": "2026-04-28T23:59:59Z",
  "series": [
    { "bucket": "2026-04-28T10:00:00Z", "state": "DELIVERED", "count": 42 }
  ]
}
```

### 3.10 Admin user (operator)

- `GET /api/admin/users?page=&size=` → 200 `{ items, total, page, size }`
- `GET /api/admin/users/:id` → 200 | 404
- `POST /api/admin/users` body `{ username, password, role, partner_id? }` → 201 | 400 | 409
- `PUT /api/admin/users/:id` body `{ password?, enabled? }` → 200 | 404

Ràng buộc role: `ADMIN` → `partner_id` phải null; `PARTNER` → `partner_id` bắt buộc.

Response (không có password field):
```json
{ "id": 1, "username": "admin", "role": "ADMIN", "partner_id": null, "enabled": true, "last_login_at": null, "created_at": "..." }
```

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

- `PATCH /api/portal/webhook` body `{ dlr_webhook }` — set DLR webhook của chính partner, `dlr_webhook` là object `{ url, method, headers }` (cùng schema JSONB với admin partner CRUD)

---

## 5. Internal endpoints — `/api/internal/*`

### 5.1 DLR ingress (3rd-party callback / worker dispatch)

- `POST /api/internal/dlr/{channel_id}`
- Auth: header `X-Internal-Secret` so với `app.internal.secret` (env `APP_INTERNAL_SECRET`).

Request body — **normalized format** (worker dispatcher hoặc 3rd-party adapter gọi sau khi normalize):
```json
{
  "telco_message_id": "msgid-from-provider",
  "state": "DELIVERED",
  "error_code": "000"
}
```

`state`: `DELIVERED` | `FAILED` | `EXPIRED` | `UNKNOWN`.

Response 204 No Content (kể cả khi `telco_message_id` không tìm thấy — tránh retry vô tận từ provider).

**Server flow:**
1. Verify `X-Internal-Secret`.
2. Tìm `message` theo `message_id_telco`. Nếu không tìm thấy → 204, log warning.
3. Lưu row `dlr` (`source=HTTP_WEBHOOK`, `raw_payload=body`).
4. Update `message.state` → `DELIVERED` hoặc `FAILED`.
5. Publish `DlrEvent` vào exchange `sms.dlr` routing key `dlr.<partner_id>`.
6. `DlrForwarder` (smpp-server, `@RabbitListener(sms.dlr.q)`) forward đến partner:
   - **SMPP**: nếu partner có active session → gửi `deliver_sm` (ESM_CLASS SMSC_DEL_RECEIPT format chuẩn).
   - **HTTP webhook**: nếu không có session, partner có `dlr_webhook` → POST JSON body `{message_id, state, dest_addr, error_code}` kèm custom headers.

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
