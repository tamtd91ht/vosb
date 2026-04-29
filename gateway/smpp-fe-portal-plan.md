# SMPP Portal Frontend (Partner) — Execution Plan

> Mục tiêu: Web portal cho **đối tác cuối** (role `PARTNER`) để monitor sản lượng, quản lý API key, SMPP account, cấu hình webhook DLR, và xem tài liệu tích hợp.
> File này là checklist sống — tick `[x]` khi task xong.
> Admin FE: `smpp-fe-admin-plan.md` (F01–F09 ✅ hoàn tất).

---

## 🔁 Resume here for next session

**Trạng thái cuối** (cập nhật `2026-04-28`): **B01 ✅ P01 ✅ P02 ✅ P03 ✅ P04 ✅ P05 ✅ P06 ✅ P07 ✅ P08 ✅** — BE portal handlers + toàn bộ FE portal xong + polish. `pnpm build` xanh 20 routes, 0 TypeScript error. Auth bypass đang bật — tắt khi cần test E2E với BE.

### Snapshot

- **Frontend dir**: `smpp/frontend/` — Next.js 16.2.4 đã có. Admin pages F01–F09 ✅.
- **Portal route group**: `src/app/(portal)/portal/` — chưa có file nào.
- **BE portal API** (`/api/portal/*`): **chưa implement** — B01 phải xong trước khi FE call được.
- **Seed partner user**: cần tạo qua `POST /api/admin/users` với `role=PARTNER` + `partner_id=<id>`.
- **Design**: Light sidebar (white + slate-50) + Sky/Teal accent — contrast với admin (dark navy + indigo). CPaaS developer-portal style.

### Quick verify sau mỗi task

```bash
# Backend
TOKEN_PARTNER=$(curl -s -X POST http://localhost:8080/api/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"partner1","password":"Partner@123456"}' | jq -r .token)
curl -H "Authorization: Bearer $TOKEN_PARTNER" http://localhost:8080/api/portal/overview

# Frontend
cd smpp/frontend
pnpm dev    # http://localhost:3000/portal/overview
```

### Environment quirks

| Vấn đề | Workaround |
|---|---|
| Auth bypass đang bật (proxy.ts + layout) | Khi test portal: cần mock session role=PARTNER hoặc tắt bypass |
| BE trả `token` (không phải `access_token`) | `data.token` trong `auth.ts` authorize() — đã xử lý cho admin, portal dùng cùng endpoint |
| CORS dev | BE cần `Access-Control-Allow-Origin: http://localhost:3000` trong dev profile |

---

## Phân tích scope

### Đối tác cần làm gì trên portal?

| Mục đích | Trang | API |
|---|---|---|
| Xem sản lượng, tỉ lệ thành công, balance | Overview | `GET /api/portal/overview` |
| Tra cứu tin nhắn đã gửi | Messages | `GET /api/portal/messages` |
| Xem chi tiết 1 tin | Message detail | `GET /api/portal/messages/{id}` |
| Tạo / thu hồi API key | API Keys | `GET/POST /api/portal/api-keys`, `POST .../revoke` |
| Xem SMPP account, đổi password | SMPP Accounts | `GET /api/portal/smpp-accounts`, `POST .../change-password` |
| Cấu hình webhook DLR | Webhook | `PATCH /api/portal/webhook` |
| Xem ví dụ tích hợp (curl, SDK) | Docs | Static |

### Design brief

**Palette**: `sky-600` primary (#0284c7) thay vì indigo admin. Clean, developer-friendly.
```
Sidebar: white (#ffffff), border-r border-slate-100, shadow-sm
Active item: sky-50 bg + sky-700 text + sky-600 dot indicator
Header: white, border-b border-slate-100
Content: bg-slate-50
Card: bg-white, shadow-sm, border-0
Button primary: bg-sky-600 hover:bg-sky-500
```
**Logo**: VOSB Gateway + "Partner Portal" subtitle (vs "Admin Console" của admin sidebar)

---

## Thứ tự thực hiện

```
B01 (portal BE handlers)
  → P01 (portal layout + auth routing)
  → P02 (overview dashboard)
  → P03 (messages + detail)
  → P04 (API keys — UX secret hiện 1 lần)
  → P05 (SMPP accounts)
  → P06 (webhook config)
  → P07 (docs + integration guide)
  → P08 (polish: toast, empty state, loading)
```

---

## B01 — Portal Backend API Handlers

### Phân tích

Portal endpoints `/api/portal/*` chưa có handler nào. Cần implement trước để FE có thể gọi. Cả 5 resource group đều đơn giản hơn admin vì:
- Không có full CRUD — portal chủ yếu là **read** + **limited write** trên chính partner mình
- `partner_id` luôn lấy từ JWT claim — không nhận từ client param (security-by-design)

**File cần tạo**:
- `smpp-server/.../http/portal/PortalRouterFactory.java` — mount tất cả portal routes
- `smpp-server/.../http/portal/overview/OverviewHandlers.java`
- `smpp-server/.../http/portal/message/PortalMessageHandlers.java`
- `smpp-server/.../http/portal/apikey/PortalApiKeyHandlers.java`
- `smpp-server/.../http/portal/smpp/PortalSmppHandlers.java`
- `smpp-server/.../http/portal/webhook/WebhookHandlers.java`

**JwtAuthHandler** đã có — mount tại router level như admin.

### Design

**`PortalRouterFactory`** — mount tất cả routes, inject `JwtAuthHandler`:
```
GET  /api/portal/overview
GET  /api/portal/messages
GET  /api/portal/messages/:id
GET  /api/portal/api-keys
POST /api/portal/api-keys             { label? }
POST /api/portal/api-keys/:id/revoke
GET  /api/portal/smpp-accounts
POST /api/portal/smpp-accounts/:id/change-password  { new_password }
PATCH /api/portal/webhook             { dlr_webhook: { url, method?, headers? } }
```

**Lấy `partnerId` từ JWT**:
```java
AuthContext auth = JwtAuthHandler.from(ctx);
Long partnerId = auth.partnerId(); // từ JWT claim
if (partnerId == null) { ctx.fail(403); return; }
```

**`GET /api/portal/overview`**:
- Đọc `partner.balance` từ DB
- `MessageRepository.countByStateAndPartnerId(partnerId)` → map state→count
- Tổng hợp: `{ balance, total_today, delivered, failed, delivery_rate }`

**`GET /api/portal/messages`** — filter `partner_id` ép từ JWT (không nhận qua query):
- Reuse `MessageRepository` thêm method `findByPartnerId(..., Pageable)`
- Filter thêm: `state`, `dest_addr`, `from`, `to`

**`POST /api/portal/api-keys`** — logic giống `ApiKeyHandlers.java` admin:
- Chỉ tạo key cho `partnerId` của chính họ (không nhận `partnerId` param)
- Trả `raw_secret` 1 lần

**`POST /api/portal/api-keys/:id/revoke`** — set `status=REVOKED`:
- Validate key thuộc về `partnerId` của JWT — prevent IDOR

**`GET /api/portal/smpp-accounts`** — chỉ trả account của partner mình, không có password field.

**`POST /api/portal/smpp-accounts/:id/change-password`**:
- Validate account thuộc về partner
- Hash new_password với bcrypt → update `password_hash`

**`PATCH /api/portal/webhook`**:
- Validate body `{ url, method?, headers? }`
- Update `partner.dlr_webhook` JSONB cho chính partner đó

**DoD**: `TOKEN_PARTNER=$(curl login partner1)` → tất cả portal endpoint trả đúng data của partner đó. IDOR test: partner A không lấy được data partner B.

---

## P01 — Portal Layout + Auth Routing

### Phân tích

1. **Cập nhật proxy.ts**: Thoát khỏi bypass mode, restore auth guard đúng cho cả admin VÀ portal:
   - ADMIN → `/admin/dashboard`
   - PARTNER → `/portal/overview`
   - Chưa login → `/login`
   
2. **Portal layout** (`src/app/(portal)/portal/layout.tsx`): Server Component, check `role === "PARTNER"`.

3. **PortalSidebar + PortalTopbar**: Riêng biệt với AdminSidebar — light theme, ít mục hơn.

4. **Cập nhật `src/app/page.tsx`**: Root `/` redirect theo role.

### Design

**File tạo**:
```
src/app/(portal)/portal/
  layout.tsx              # Server Component, role guard PARTNER
  overview/page.tsx       # placeholder → P02
  messages/
    page.tsx
    [id]/page.tsx
  api-keys/page.tsx
  smpp-accounts/page.tsx
  webhook/page.tsx
  docs/page.tsx

src/components/layout/
  PortalSidebar.tsx       # Light theme, sky accent
  PortalTopbar.tsx        # Đồng nhất với AdminTopbar nhưng show partner name
```

**PortalSidebar menu**:
| Icon | Label | Path |
|---|---|---|
| LayoutDashboard | Tổng quan | /portal/overview |
| MessageSquare | Tin nhắn | /portal/messages |
| Key | API Keys | /portal/api-keys |
| Server | SMPP Accounts | /portal/smpp-accounts |
| Webhook / Link | Webhook | /portal/webhook |
| BookOpen | Tài liệu | /portal/docs |

**Màu active item**: `bg-sky-50 text-sky-700` (vs admin `bg-indigo-600/15 text-indigo-300`)
**Sidebar bg**: `#ffffff` (vs admin `#0a0f23`)

**proxy.ts restored** (thay thế bypass):
```ts
export default auth((req) => {
  const session = req.auth;
  const path = req.nextUrl.pathname;
  
  if (path === "/login" || path.startsWith("/api/auth")) return NextResponse.next();
  if (!session || session.error === "refresh_failed")
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  
  const role = session.user?.role;
  if (path === "/") {
    return NextResponse.redirect(new URL(
      role === "ADMIN" ? "/admin/dashboard" : "/portal/overview", req.nextUrl
    ));
  }
  if (path.startsWith("/admin") && role !== "ADMIN")
    return NextResponse.redirect(new URL("/portal/overview", req.nextUrl));
  if (path.startsWith("/portal") && role !== "PARTNER")
    return NextResponse.redirect(new URL("/admin/dashboard", req.nextUrl));
});
```

**DoD**: Login admin → `/admin/dashboard`. Login partner → `/portal/overview`. Sai role → redirect đúng. Portal layout render với sidebar light theme.

---

## P02 — Portal Overview

### Phân tích

Overview là trang đầu tiên partner thấy sau login. Cần:
1. **Balance card**: số dư tài khoản (prominent — đây là thông tin quan trọng nhất)
2. **Stats hôm nay**: tổng tin, tỉ lệ thành công, thất bại
3. **Mini chart 24h**: AreaChart đơn giản (delivered vs failed)
4. **Recent messages**: 5 tin gần nhất

**API**: `GET /api/portal/overview` → `{ balance, stats: { DELIVERED, FAILED, ... }, partner_code, partner_name }`

### Design

```
src/app/(portal)/portal/overview/
  page.tsx
  OverviewClient.tsx    # "use client"
```

**Layout**:
```
┌─ Balance ──────────────────┐  ┌─ Tổng hôm nay ──┐  ┌─ Tỉ lệ ──┐  ┌─ Thất bại ──┐
│  💰 0 VNĐ                  │  │   0              │  │  0.0%    │  │  0         │
│  Số dư tài khoản           │  │   tin nhắn       │  │ thành cô  │  │            │
└────────────────────────────┘  └─────────────────┘  └──────────┘  └────────────┘

┌─ Sản lượng 24h ──────────────────────────────────────────────────────────────────┐
│  [AreaChart DELIVERED (emerald) + FAILED (red)]                                  │
└──────────────────────────────────────────────────────────────────────────────────┘

┌─ Tin nhắn gần đây ───────────────────────────────────────────────────────────────┐
│  ID       Đích           Trạng thái    Thời gian                     [Xem tất cả]│
└──────────────────────────────────────────────────────────────────────────────────┘
```

Balance card dùng màu nổi bật: `bg-gradient-to-br from-sky-500 to-cyan-600 text-white`.

**DoD**: Overview load với skeleton. Balance hiển thị số dư. Chart vẽ 24h. Recent messages link sang `/portal/messages`.

---

## P03 — Portal Messages

### Phân tích

Partner chỉ thấy tin nhắn của mình. Filter: `state`, `dest_addr`, date range. Pagination.

**Điểm khác admin messages**: Không có `partner_id` filter (ép từ JWT), không có bulk action.

### Design

```
src/app/(portal)/portal/messages/
  page.tsx
  MessagesClient.tsx    # filter bar + table + pagination
  [id]/
    page.tsx
    MessageDetailClient.tsx  # state timeline + raw fields
```

**MessagesClient columns**: Dest Addr, Content (truncate), State badge, Channel, Created At, Actions (Xem).

**MessageDetailClient**:
- State timeline: `RECEIVED → ROUTED → SUBMITTED → DELIVERED/FAILED`
- Raw fields: message_id, source_addr, encoding, inbound_via, client_ref
- `message_id_telco` nếu có
- Error code + mô tả nếu FAILED

**DoD**: List load đúng chỉ tin của partner hiện tại. Filter state FAILED → chỉ failed. Click detail → timeline đúng.

---

## P04 — API Keys Management

### Phân tích

Đây là flow quan trọng nhất từ UX góc độ bảo mật. **Raw secret chỉ hiện 1 lần.**

Flow tạo key:
1. Partner click "Tạo API Key" → nhập label (optional)
2. `POST /api/portal/api-keys` → nhận `{ key_id, raw_secret, label }`
3. **Dialog đặc biệt**: nền blur, icon cảnh báo, hiện `key_id` + `raw_secret`, 2 nút Copy, nút "Tôi đã lưu lại — Đóng"
4. Sau khi đóng → không bao giờ xem lại được

Flow revoke:
1. Click "Thu hồi" → `ConfirmDialog`
2. `POST /api/portal/api-keys/:id/revoke` → status=REVOKED, badge đổi màu

### Design

```
src/app/(portal)/portal/api-keys/
  page.tsx
  ApiKeysClient.tsx
  components/
    NewKeyDialog.tsx        # form label + submit
    SecretRevealDialog.tsx  # show key_id + raw_secret 1 lần (important UX)
```

**SecretRevealDialog**:
```
┌─────────────────────────────────────────────────────┐
│  🔑  API Key tạo thành công                         │
│  ─────────────────────────────────────────────────  │
│  ⚠️  Đây là lần DUY NHẤT bạn thấy secret này.      │
│      Hãy sao chép và lưu ngay. Sau khi đóng,        │
│      VOSB Gateway không thể hiển thị lại.            │
│  ─────────────────────────────────────────────────  │
│  Key ID                                             │
│  [ak_live_aBcDeFgH1234567890]          [📋 Copy]   │
│                                                     │
│  Secret Key                                         │
│  [••••••••••••••••••] [👁 Hiện] [📋 Copy]          │
│                                                     │
│  Label: Production Key                              │
│  ─────────────────────────────────────────────────  │
│            [Tôi đã lưu lại — Đóng dialog]          │
└─────────────────────────────────────────────────────┘
```

**ApiKeys table columns**: Label, Key ID (monospace), Status badge, Last Used, Created At, Actions (Thu hồi).

**DoD**: Tạo key → SecretRevealDialog xuất hiện với raw_secret. Copy button copy vào clipboard + toast "Đã sao chép". Đóng → key xuất hiện trong list với status=ACTIVE. Revoke → status=REVOKED, badge đỏ, không thể dùng nữa.

---

## P05 — SMPP Accounts (Readonly + Đổi mật khẩu)

### Phân tích

Partner không được tạo/xóa SMPP account (admin quản lý). Partner chỉ:
- Xem danh sách account của mình (system_id, max_binds, ip_whitelist, status)
- Đổi password (tự quản lý credential SMPP)

**Sensitive info**: Không hiện password hash. `ip_whitelist` hiện để partner biết cấu hình.

### Design

```
src/app/(portal)/portal/smpp-accounts/
  page.tsx
  SmppAccountsClient.tsx
  components/
    ChangePasswordDialog.tsx   # new_password + confirm
```

**Table columns**: System ID (monospace, copiable), Max Binds, IP Whitelist, Status, Actions (Đổi mật khẩu).

**ChangePasswordDialog**: Zod schema `{ new_password: z.string().min(8), confirm: z.string() }.refine(match)`. Submit → `POST /api/portal/smpp-accounts/:id/change-password`.

**Info box**: "Sau khi đổi mật khẩu, các phiên SMPP đang kết nối sẽ bị ngắt và cần kết nối lại với mật khẩu mới."

**DoD**: List hiển thị đúng SMPP account của partner. Đổi mật khẩu → toast success. Mật khẩu mới < 8 ký tự → validation error inline.

---

## P06 — Webhook DLR Config

### Phân tích

Partner cấu hình URL nhận DLR từ gateway. Cần UX rõ ràng vì đây là critical integration config.

**API**: `PATCH /api/portal/webhook` body `{ dlr_webhook: { url, method, headers } }`

**Pre-fill**: Load current webhook config từ `GET /api/portal/overview` (hoặc endpoint riêng).

**Header editor**: Dynamic key-value list (thêm/xóa row) — giống admin partner form nhưng đơn độc lập 1 page.

### Design

```
src/app/(portal)/portal/webhook/
  page.tsx
  WebhookClient.tsx
  components/
    HeadersEditor.tsx    # dynamic key-value pairs
```

**WebhookClient layout**:
```
┌─ Cấu hình DLR Webhook ──────────────────────────────────────────────────────────┐
│                                                                                  │
│  Khi tin nhắn có trạng thái mới (DELIVERED/FAILED), VOSB Gateway sẽ gọi HTTP    │
│  đến URL bên dưới với payload JSON.                                              │
│                                                                                  │
│  Webhook URL *                                                                   │
│  [https://your-server.com/dlr-callback              ]                            │
│                                                                                  │
│  HTTP Method          Content-Type (auto)                                        │
│  [POST ▼]             application/json                                           │
│                                                                                  │
│  Custom Headers (tùy chọn)                                                       │
│  [Authorization    ] : [Bearer your-webhook-secret  ] [🗑]                       │
│  [X-Partner-Token  ] : [vosb-partner-abc123          ] [🗑]                       │
│  [+ Thêm header]                                                                 │
│                                                                                  │
│  ┌─ Payload mẫu ────────────────────────────────────────┐                       │
│  │ { "message_id": "...", "state": "DELIVERED",         │                       │
│  │   "dest_addr": "84901234567", "delivered_at": "..." } │                       │
│  └──────────────────────────────────────────────────────┘                       │
│                                                                                  │
│                                         [Hủy]  [Lưu cấu hình]                   │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**DoD**: Load current config pre-filled. Save → toast "Đã lưu webhook". URL không hợp lệ → validation error. Header editor thêm/xóa row được.

---

## P07 — Tài liệu Tích hợp (Docs)

### Phân tích

Partner cần biết cách gọi API. Trang docs là static (không call BE) với:
- Curl example gửi tin nhắn via API key
- Code snippet Node.js / Python
- Mô tả SMPP config (host, port, system_id)
- Link tải test tool

Cần hiển thị **Key ID thực của partner** (lấy từ API key list đầu tiên) để họ copy vào curl ngay.

### Design

```
src/app/(portal)/portal/docs/
  page.tsx           # Server Component — đơn giản, mostly static
  components/
    CodeBlock.tsx    # syntax highlight block + copy button
    ApiEndpointCard.tsx
```

**Sections**:
1. **Tổng quan** — gateway URL, auth method
2. **Gửi tin nhắn qua API** — curl example với `X-Api-Key` header
3. **Kết nối SMPP** — host/port/system_id/password (lấy từ `/api/portal/smpp-accounts`)
4. **DLR Callback** — payload format
5. **Rate limits** — 100 req/s per key

**CodeBlock** với copy button (dùng `navigator.clipboard.writeText`). Highlight bằng class CSS đơn giản (không cần library nặng).

**DoD**: Trang load nhanh (static). CodeBlock copy được. Curl example có `YOUR_KEY_ID` placeholder (hoặc key_id thật nếu có).

---

## P08 — Polish

### Phân tích

Nhất quán UX toàn bộ portal:

1. **Toast notifications** — tất cả mutation success/error → sonner toast (reuse từ admin)
2. **Empty states** — mỗi table có empty state rõ ràng (icon + message + CTA nếu phù hợp)
3. **Loading skeletons** — card skeleton khi fetch overview, table skeleton khi load messages
4. **Error boundary** — `error.tsx` cho mỗi route group portal
5. **404 page** — `not-found.tsx`
6. **Responsive** — sidebar collapse ≤ 768px, table scroll horizontal
7. **Page titles** — `metadata` đúng mỗi page
8. **Aria labels** — icon-only button có `aria-label`

### DoD

- `pnpm build` xanh, 0 TypeScript error.
- F5 mọi trang không bị lỗi.
- Mọi action có toast.
- Tables không có data → empty state thân thiện.

---

## Checklist tổng

| Task | Mô tả | Depends | Size | Status |
|---|---|---|---|---|
| **B01** | Portal BE: 5 handler groups (overview/messages/api-keys/smpp/webhook) | — | M | [x] |
| **P01** | Portal layout (sidebar/topbar) + restore auth routing | B01 | S | [x] |
| **P02** | Overview: balance card + stats + mini chart + recent messages | P01 | M | [x] |
| **P03** | Messages: filter list + detail timeline | P01 | M | [x] |
| **P04** | API Keys: tạo + SecretRevealDialog + revoke | P01 | M | [x] |
| **P05** | SMPP Accounts: readonly list + change-password dialog | P01 | S | [x] |
| **P06** | Webhook config: URL + method + dynamic headers editor | P01 | S | [x] |
| **P07** | Docs: static integration guide + code blocks | P01 | S | [x] |
| **P08** | Polish: toast, empty state, error boundary, responsive | P02–P07 | S | [x] |

Size: S=<2h, M=2-4h

---

## Portal API endpoints (BE cần implement trong B01)

| Endpoint | Handler | Method | Auth |
|---|---|---|---|
| `GET /api/portal/overview` | OverviewHandlers | GET | JWT PARTNER |
| `GET /api/portal/messages` | PortalMessageHandlers | GET | JWT PARTNER |
| `GET /api/portal/messages/:id` | PortalMessageHandlers | GET | JWT PARTNER |
| `GET /api/portal/api-keys` | PortalApiKeyHandlers | GET | JWT PARTNER |
| `POST /api/portal/api-keys` | PortalApiKeyHandlers | POST | JWT PARTNER |
| `POST /api/portal/api-keys/:id/revoke` | PortalApiKeyHandlers | POST | JWT PARTNER |
| `GET /api/portal/smpp-accounts` | PortalSmppHandlers | GET | JWT PARTNER |
| `POST /api/portal/smpp-accounts/:id/change-password` | PortalSmppHandlers | POST | JWT PARTNER |
| `PATCH /api/portal/webhook` | WebhookHandlers | PATCH | JWT PARTNER |

---

## Frontend files sẽ tạo

```
src/app/(portal)/portal/
├── layout.tsx
├── overview/
│   ├── page.tsx
│   └── OverviewClient.tsx
├── messages/
│   ├── page.tsx
│   ├── MessagesClient.tsx
│   └── [id]/
│       ├── page.tsx
│       └── MessageDetailClient.tsx
├── api-keys/
│   ├── page.tsx
│   └── ApiKeysClient.tsx
├── smpp-accounts/
│   ├── page.tsx
│   └── SmppAccountsClient.tsx
├── webhook/
│   ├── page.tsx
│   └── WebhookClient.tsx
└── docs/
    └── page.tsx

src/components/layout/
├── PortalSidebar.tsx     # light theme
└── PortalTopbar.tsx

src/components/portal/
├── SecretRevealDialog.tsx
├── ChangePasswordDialog.tsx
├── HeadersEditor.tsx
└── CodeBlock.tsx
```

---

## Conventions bổ sung cho Portal FE

- Portal Client Components dùng `useSession()` → lấy `accessToken` như admin.
- API calls: `apiClient(token, "/api/portal/...")` — prefix `/api/portal/` không phải `/api/admin/`.
- Không bao giờ truyền `partner_id` qua query param trong portal — server lấy từ JWT.
- `SecretRevealDialog` phải block đóng bằng backdrop click (chỉ đóng bằng nút "Tôi đã lưu") để tránh accident dismiss.
- Empty state: dùng `EmptyState` component từ admin shared (`src/components/common/EmptyState.tsx`).
- Colors portal: `sky-600` primary, `sky-50` hover/active bg — KHÔNG dùng `indigo` (đó là admin).
