# SMPP Admin Frontend — Execution Plan

> Mục tiêu: Admin web app để **cấu hình** (partner/channel/route/user) và **monitor sản lượng** (dashboard, message log, SMPP session).
> File này là checklist sống — tick `[x]` khi task xong.
> Tách riêng khỏi `smpp-plan.md` để dễ theo dõi. Portal FE sẽ có file riêng sau.

---

## 🔁 Resume here for next session

**Trạng thái cuối** (cập nhật `2026-04-28`): **F01–F09 ✅ hoàn tất**. Frontend admin đã build xanh + dev server chạy được. Task tiếp theo: Portal FE (tách file riêng `smpp-fe-portal-plan.md`) hoặc Backend T20 (jSMPP listener).

### Snapshot

- **Frontend dir**: `smpp/frontend/` — đầy đủ Next.js 16.2.4 (App Router, TypeScript, Tailwind v4, shadcn/ui, NextAuth v5, TanStack Query v5, Recharts).
- **`pnpm build`**: xanh — 12 routes, 0 TypeScript error, 0 warning.
- **Dev server**: `pnpm dev` → `http://localhost:3000` → redirect `/login` → login page render đúng gradient.
- **BE đã sẵn sàng**: Phase 2 hoàn tất (`smpp-plan.md` T01–T19 ✅). Admin API live khi infra container chạy.
- **BE base URL** (local dev): `http://localhost:8080`
- **Login**: `POST /api/admin/auth/login` → response `{ token, refresh_token, expires_in }` (field là `token`, không phải `access_token`).
- **Seed admin**: username `admin`, password `Admin@123456`
- **Design**: CPaaS style (Twilio/Vonage inspired). Sidebar `#0a0f23` (dark navy) + indigo-600 accent. Gradient login page `from-slate-950 via-indigo-950 to-slate-900`.

### Quick verify

```bash
cd smpp/frontend
pnpm dev          # http://localhost:3000 → /login
# Login cần BE + infra containers chạy:
#   docker compose -f smpp/docker-compose.yml up -d
#   JAVA_HOME="C:/Program Files/Java/jdk-21.0.11" ./mvnw -pl smpp-server spring-boot:run
```

### Environment quirks (phòng trước)

| Vấn đề | Workaround |
|---|---|
| BE response field `token` (không phải `access_token`) | Trong NextAuth `authorize()`: dùng `data.token` thay `data.access_token`. Tương tự refresh: `data.token` |
| Tailwind v4 syntax khác v3 | Dùng `@import "tailwindcss"` + `@theme {}` block, KHÔNG `@tailwind base/components/utilities` |
| shadcn/ui với Next.js 15 App Router | `components.json` cần `rsc: true`, dùng `npx shadcn@latest init` |
| NextAuth v5 (Auth.js) | Export `{ handlers, signIn, signOut, auth }` từ `lib/auth.ts`; route handler: `export { GET, POST } from "@/lib/auth"` |
| TanStack Query v5 API thay đổi | `useQuery` không có `onSuccess` callback nữa — dùng `select` hoặc `useEffect` |
| Server Component không dùng `useSession` | Dùng `auth()` từ `lib/auth.ts` cho Server Component; `useSession()` chỉ cho Client Component |

---

## Thứ tự thực hiện

```
F01 (scaffold)
  → F02 (auth + login)
  → F03 (layout + shared lib)
  → F04 (dashboard)
  → F05 (partners CRUD)
  → F06 (channels + routes)
  → F07 (messages)
  → F08 (sessions + users)
```

F04 phụ thuộc F03. F05-F08 có thể làm tuần tự sau F03.

---

## F01 — Project Scaffold

### Phân tích

Frontend cần khởi tạo từ đầu. Stack đã chốt trong `docs/frontend.md`:
- **Next.js 15** App Router, TypeScript strict, `output: "standalone"`
- **Tailwind CSS v4** — syntax mới (`@import "tailwindcss"`, `@theme {}`)
- **shadcn/ui** — Radix + Tailwind, copy vào repo
- **pnpm** (không npm/yarn)
- **Dependencies chính**: `next-auth@beta` (v5), `@tanstack/react-query` v5, `react-hook-form`, `zod`, `recharts`, `date-fns`, `lucide-react`, `@tanstack/react-table` v8

### Đề xuất

Init `smpp/frontend/` với `create-next-app` → thêm deps → cấu hình `next.config.ts` → setup Tailwind v4 → init shadcn → tạo file cấu trúc skeleton (thư mục trống + `.gitkeep`).

**Không** cài NextAuth, TanStack Query, etc. trong bước này — chỉ project scaffold để build xanh trước.

### Design

**Files tạo**:
```
smpp/frontend/
├── package.json                 # deps: next 15, react 19, tailwind 4, typescript 5
├── pnpm-lock.yaml
├── next.config.ts               # output: standalone, reactStrictMode: true
├── tsconfig.json                # strict, paths alias @/*→src/*
├── postcss.config.mjs
├── components.json              # shadcn: style default, rsc true, tsx true
├── .env.example                 # API_BASE_INTERNAL, NEXT_PUBLIC_API_BASE, NEXTAUTH_SECRET
├── .gitignore
├── Dockerfile
├── .dockerignore
└── src/
    ├── app/
    │   ├── globals.css          # Tailwind v4 import + @theme vars
    │   ├── layout.tsx           # root layout (html, body)
    │   └── page.tsx             # redirect → /login tạm
    └── components/
        └── ui/                  # (trống, shadcn sẽ add vào đây)
```

**shadcn components cài ngay**: `button`, `input`, `label`, `card`, `badge`, `separator`, `skeleton`, `sonner` (toast), `dialog`, `dropdown-menu`, `table`, `select`, `form`.

**DoD**: `pnpm dev` không lỗi, `http://localhost:3000` render được (redirect hoặc blank OK), `pnpm build` xanh.

---

## F02 — Auth Foundation

### Phân tích

NextAuth v5 (Auth.js) với Credentials provider. Flow:
1. User POST form `/login` → NextAuth `authorize()` → gọi `POST /api/admin/auth/login` → nhận `{ token, refresh_token, expires_in }` → lưu trong JWT session.
2. Mọi request có token đính vào header `Authorization: Bearer`.
3. Token hết hạn: refresh via `POST /api/admin/auth/refresh` → `{ token, expires_in }`.
4. Middleware check session → redirect nếu chưa login hoặc sai role.

**Điểm quan trọng**: BE trả `token` (không phải `access_token`) — mapping phải đúng trong `authorize()` và refresh.

**Logout**: call `POST /api/admin/auth/logout` (BE blacklist jti), sau đó `signOut()` NextAuth.

### Đề xuất

- `lib/auth.ts` — NextAuth config, `authorize()`, refresh logic, session callback
- `lib/api.ts` — `apiFetch()` wrapper dùng cho cả server + client side
- `middleware.ts` — role guard: ADMIN → `/admin/*`, PARTNER → `/portal/*`, chưa login → `/login`
- `app/login/page.tsx` — login form (React Hook Form + Zod)
- `app/api/auth/[...nextauth]/route.ts`

### Design

**`src/lib/auth.ts`** — key sections:
```ts
// authorize() mapping:
return {
  id: String(data.id),          // từ /me call sau login
  name: data.username,
  role: data.role,
  partnerId: data.partner_id ?? null,
  accessToken: data.token,       // BE trả "token" không phải "access_token"
  refreshToken: data.refresh_token,
  expiresAt: Date.now() + data.expires_in * 1000,
};

// refresh mapping:
accessToken: refreshData.token,  // không phải access_token
```

**`src/lib/api.ts`**:
- `apiFetch(path, opts)` — auto attach Bearer, handle 401 (throw), serialize body
- Server-side dùng `API_BASE_INTERNAL`, client-side dùng `NEXT_PUBLIC_API_BASE`
- Throw `ApiError` với `status` + `problem` (RFC 7807 body)

**`src/lib/types.ts`** — TypeScript types cho toàn bộ domain:
- `Partner`, `PartnerSmppAccount`, `PartnerApiKey`, `Channel`, `Route`, `Message`, `AdminUser`
- `PageResponse<T>`, `AuthSession`

**`src/lib/schemas.ts`** — Zod schemas:
- `loginSchema`, `createPartnerSchema`, `createChannelSchema`, `createRouteSchema`, `createUserSchema`

**Login page**: Card căn giữa, username + password field, submit → `signIn("credentials")`, error state khi 401.

**DoD**: Login với `admin` / `Admin@123456` → redirect `/admin/dashboard` (trang chưa có thì 404 OK). Gọi `/api/admin/auth/me` sau login → đúng user. Gõ `http://localhost:3000/admin/dashboard` khi chưa login → redirect `/login`. Token refresh tự động khi gần hết hạn.

---

## F03 — Admin Layout + Shared Components

### Phân tích

Layout là bộ khung dùng cho toàn bộ admin pages. Cần hoàn thiện trước khi build từng page, vì mọi page đều mount vào layout này.

Thành phần:
- **Sidebar**: menu items với icon (Dashboard, Partners, Channels, Routes, Messages, Sessions, Users), collapse được trên mobile.
- **Topbar**: breadcrumb, user avatar dropdown (profile + logout), theme toggle.
- **Route guard**: `(admin)/admin/layout.tsx` check role = ADMIN, nếu không redirect.

Shared components cần dùng ở nhiều page:
- `DataTable` — TanStack Table v8 + shadcn Table, hỗ trợ pagination, sort, column visibility.
- `PageHeader` — title + description + action button (Create).
- `StatusBadge` — badge màu theo status (ACTIVE=green, SUSPENDED=orange, DISABLED=gray, REVOKED=red).
- `ConfirmDialog` — "Bạn có chắc?" dialog tái sử dụng.
- `EmptyState` — placeholder khi không có data.
- `LoadingSpinner` — skeleton/spinner.

### Design

```
src/
├── app/
│   ├── (admin)/
│   │   └── admin/
│   │       ├── layout.tsx          # sidebar + topbar, role guard
│   │       └── dashboard/
│   │           └── page.tsx        # placeholder → F04 fill
│   └── login/
│       └── page.tsx                # F02
├── components/
│   ├── ui/                         # shadcn (đã có từ F01)
│   ├── layout/
│   │   ├── AdminSidebar.tsx
│   │   ├── AdminTopbar.tsx
│   │   └── AdminLayout.tsx
│   ├── data-table/
│   │   ├── DataTable.tsx           # generic TanStack Table
│   │   ├── DataTablePagination.tsx
│   │   └── DataTableColumnHeader.tsx
│   └── common/
│       ├── PageHeader.tsx
│       ├── StatusBadge.tsx
│       ├── ConfirmDialog.tsx
│       └── EmptyState.tsx
├── lib/
│   ├── auth.ts                     # F02
│   ├── api.ts                      # F02
│   ├── types.ts                    # F02
│   ├── schemas.ts                  # F02
│   └── utils.ts                    # cn(), formatDate(), formatDateTime()
└── hooks/
    └── useToast.ts                 # sonner wrapper
```

**Sidebar menu items**:
| Icon | Label | Path |
|---|---|---|
| LayoutDashboard | Dashboard | /admin/dashboard |
| Users2 | Đối tác | /admin/partners |
| Radio | Kênh | /admin/channels |
| GitFork | Route | /admin/routes |
| MessageSquare | Tin nhắn | /admin/messages |
| Wifi | Sessions | /admin/sessions |
| UserCog | Người dùng | /admin/users |

**TanStack Query setup**: Wrap toàn bộ trong `app/layout.tsx` với `QueryClientProvider`.

**DoD**: Navigate được giữa các menu item. Sidebar collapse OK. Logout từ topbar dropdown → về `/login`. `DataTable` render được với mock data. `StatusBadge` hiển thị đúng màu.

---

## F04 — Dashboard (Monitor sản lượng)

### Phân tích

Dashboard là màn hình đầu tiên sau login — cần cho operator thấy tổng quan ngay lập tức:
1. **Stats cards**: Tổng tin nhắn hôm nay, delivered rate, failed count, active sessions (stub Phase 2).
2. **Timeseries chart**: Recharts LineChart, số tin theo giờ/ngày, group by state (DELIVERED vs FAILED vs IN_FLIGHT).
3. **Bộ lọc thời gian**: Today / Last 7 days / Last 30 days (Date range picker).
4. **Recent messages**: 10 tin nhắn gần nhất với state badge.

**API calls**:
- `GET /api/admin/stats/overview` → `{ RECEIVED: N, DELIVERED: N, FAILED: N, ... }`
- `GET /api/admin/stats/timeseries?granularity=hour&from=&to=` → `{ series: [{bucket, state, count}] }`
- `GET /api/admin/messages?page=0&size=10` → `{ items, total }`
- `GET /api/admin/sessions` → `{ items: [], total: 0 }` (stub)

### Design

```
src/app/(admin)/admin/dashboard/
  page.tsx              # Server Component: fetch overview + timeseries SSR
  DashboardClient.tsx   # "use client": Recharts chart + date range picker
  StatsCards.tsx        # 4 metric cards
  RecentMessages.tsx    # mini table 10 rows
```

**StatsCards layout** (4 card hàng ngang):
```
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│ Tổng hôm nay│ │  Delivered  │ │   Failed    │ │  Sessions   │
│     1,234   │ │   98.2 %    │ │      22     │ │      3      │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
```

**TimeseriesChart**: Recharts `ComposedChart` với `Area` (delivered, xanh), `Line` (failed, đỏ). X-axis format `HH:mm` nếu granularity=hour, `dd/MM` nếu granularity=day. Tooltip hiển thị số liệu cụ thể.

**Date range**: 3 quick preset button (Hôm nay / 7 ngày / 30 ngày) + custom DatePicker nếu cần (shadcn Calendar component). Thay đổi range → refetch timeseries + overview.

**Auto-refresh**: `refetchInterval: 60_000` (1 phút) trên TanStack Query để dashboard tự update.

**DoD**: Dashboard load xanh. Chart vẽ đúng dữ liệu từ API. Chọn 7 ngày → chart update. Auto-refresh sau 60s không gây flash/reload. Recent messages hiển thị state badge đúng màu.

---

## F05 — Partners Management (Cấu hình đối tác)

### Phân tích

Đây là màn hình cấu hình phức tạp nhất — partner có nested resources (SMPP accounts, API keys). Cần layout tab hoặc nested page.

**Partner list**: Table với columns `Code`, `Name`, `Status`, `Balance`, `Created At` + Actions (View, Suspend).

**Partner detail** (`/admin/partners/:id`): Tab layout:
- **Thông tin chung**: tên, webhook config (form), balance display.
- **SMPP Accounts**: table + create form (system_id, password, max_binds, ip_whitelist).
- **API Keys**: table (ẩn secret) + create button → dialog hiện `raw_secret` 1 lần duy nhất + copy button.

**Form dlr_webhook**: URL input + Method select (GET/POST/PUT/PATCH) + Headers editor (key-value pairs dynamic).

**UX quan trọng**: khi tạo API key xong, dialog show `raw_secret` với cảnh báo "Đây là lần duy nhất bạn thấy secret này. Hãy copy ngay." + copy-to-clipboard button.

### Design

```
src/app/(admin)/admin/partners/
  page.tsx                        # Server: fetch partner list
  PartnersTable.tsx               # "use client": table + create dialog
  CreatePartnerDialog.tsx         # modal form: code, name, dlr_webhook
  [id]/
    page.tsx                      # Server: fetch partner detail
    PartnerDetailClient.tsx       # "use client": tab layout
    tabs/
      GeneralTab.tsx              # edit form: name, dlr_webhook
      SmppAccountsTab.tsx         # table + create form
      ApiKeysTab.tsx              # table + create → show secret dialog
    components/
      DlrWebhookForm.tsx          # URL + Method + Headers editor
      ApiKeySecretDialog.tsx      # "copy this now" UX

src/hooks/
  usePartners.ts                  # useQuery + useMutation for partners
  useSmppAccounts.ts
  useApiKeys.ts
```

**DlrWebhookForm** — sub-form embed vào CreatePartner + EditPartner:
```
┌─ DLR Webhook ─────────────────────────────────────┐
│ URL:     [https://partner.example.com/dlr        ] │
│ Method:  [POST ▼]                                  │
│ Headers: [Authorization] : [Bearer secret]  [+ Add]│
│          [X-Custom-Key ] : [value         ]  [🗑]  │
└────────────────────────────────────────────────────┘
```

**ApiKeySecretDialog** — sau khi tạo key thành công:
```
┌─ API Key tạo thành công ────────────────────────────┐
│ ⚠ Chỉ hiển thị 1 lần duy nhất!                     │
│                                                     │
│ Key ID:     ak_live_aBcDeFgH1234567        [Copy]   │
│ Raw Secret: base64url_32_bytes_here...     [Copy]   │
│                                                     │
│ Sau khi đóng dialog này, secret sẽ không thể        │
│ xem lại được nữa.                                   │
│                           [Tôi đã lưu lại] [Đóng]  │
└────────────────────────────────────────────────────┘
```

**Zod schemas**:
```ts
const dlrWebhookSchema = z.object({
  url: z.string().url("URL không hợp lệ"),
  method: z.enum(["GET", "POST", "PUT", "PATCH"]).default("POST"),
  headers: z.record(z.string()).optional(),
});

const createPartnerSchema = z.object({
  code: z.string().min(2).max(64).regex(/^[A-Z0-9_]+$/, "Chỉ chữ hoa, số và _"),
  name: z.string().min(1).max(255),
  dlr_webhook: dlrWebhookSchema.optional(),
});
```

**DoD**: Tạo partner mới → xuất hiện trong list. Xem detail → 3 tab hoạt động. Tạo SMPP account → password hash (BE), response không có password. Tạo API key → dialog xuất hiện với raw_secret, nút copy OK. Suspend partner → status badge đổi màu.

---

## F06 — Channels + Routes (Cấu hình kênh & định tuyến)

### Phân tích

**Channels**: Mỗi channel có `type` khác nhau → form config khác nhau. Cần dynamic form theo type.

| Type | Config fields bắt buộc |
|---|---|
| HTTP_THIRD_PARTY | url, method, auth_type |
| FREESWITCH_ESL | host, port, password |
| TELCO_SMPP | host, port, system_id, password |

**Routes**: Bảng routing `(partner, msisdn_prefix) → channel`. Priority 1-999. KHÔNG có duplicate `(partner_id, msisdn_prefix, priority)` → 409.

**test-ping button** trên channel detail: gọi `POST /api/admin/channels/:id/test-ping` → hiển thị kết quả inline (latency hoặc "not supported").

### Design

```
src/app/(admin)/admin/
  channels/
    page.tsx                      # list + filter by type/status
    ChannelsTable.tsx
    CreateChannelDialog.tsx       # type selector → conditional config fields
    [id]/
      page.tsx                    # detail + edit + test-ping
      ChannelDetailClient.tsx
  routes/
    page.tsx                      # all routes (cross-partner), filter by partner_id
    RoutesTable.tsx
    CreateRouteDialog.tsx

src/hooks/
  useChannels.ts
  useRoutes.ts
```

**CreateChannelDialog** — type-dependent config:
```
Step 1: Chọn type (card picker với icon)
  [🌐 HTTP Third Party] [📞 FreeSWITCH ESL] [📱 Telco SMPP]

Step 2: Nhập config (fields thay đổi theo type)
  Code: [               ]   Name: [              ]
  --- HTTP config: ---
  URL:       [https://...         ]
  Method:    [POST ▼]
  Auth Type: [Bearer ▼]
```

**RoutesTable columns**: Partner, MSISDN Prefix, Channel, Fallback Channel, Priority, Enabled toggle, Actions.

**DoD**: Tạo channel HTTP_THIRD_PARTY → xuất hiện list. Test-ping → modal hiển thị kết quả. Tạo route → xuất hiện. Toggle enabled trực tiếp trong table (PATCH inline). 409 khi trùng unique constraint → toast error.

---

## F07 — Messages (Monitor tin nhắn)

### Phân tích

Messages là màn hình monitoring chính. Operator cần tìm tin theo nhiều tiêu chí và xem lịch sử state của 1 tin.

**List**: Server-side render + client-side refetch. Filter: partner, state, dest_addr, date range. Sort: createdAt DESC. Paginated.

**Detail**: Timeline các state transition (dùng `created_at`, `updated_at`, state field). DLR info (Phase 3+).

### Design

```
src/app/(admin)/admin/messages/
  page.tsx                      # Server: first page load with default filters
  MessagesTable.tsx             # "use client": filter bar + table
  FilterBar.tsx                 # partner select, state select, dest_addr input, date range
  [id]/
    page.tsx                    # Server: fetch message detail
    MessageDetailClient.tsx     # timeline + raw fields

src/hooks/
  useMessages.ts
```

**MessagesTable columns**: ID (truncate), Partner, Dest Addr, Content (truncate 40 chars), State badge, Channel, Created At, Actions (View).

**FilterBar**:
```
[Partner ▼] [State ▼] [Số điện thoại...] [Từ ngày] [Đến ngày] [Tìm kiếm]
```

**Message detail timeline**:
```
● RECEIVED    28/04/2026 09:30:00
● ROUTED      28/04/2026 09:30:01  → Kênh: VIETTEL_SMPP
● SUBMITTED   28/04/2026 09:30:02  → message_id_telco: SM-12345
● DELIVERED   28/04/2026 09:30:08
```
State màu: RECEIVED=blue, ROUTED=blue, SUBMITTED=yellow, DELIVERED=green, FAILED=red.

**DoD**: Filter theo partner → chỉ hiện tin của partner đó. Filter theo state FAILED → hiện failed. Click detail → xem timeline đúng. Pagination qua trang 2 → đúng data.

---

## F08 — Sessions + Users

### Phân tích

**Sessions** (Phase 2: stub): List trả `{ items: [], total: 0 }`. Hiển thị empty state với message "Chức năng này khả dụng từ Phase 3 khi SMPP listener được kích hoạt." Auto-refresh 30s (khi Phase 3 xong sẽ có data).

**Users**: CRUD admin users — admin nội bộ. Columns: Username, Role badge, Partner (nếu PARTNER role), Enabled toggle, Last Login, Actions.

### Design

```
src/app/(admin)/admin/
  sessions/
    page.tsx                    # fetch stub + empty state
    SessionsTable.tsx
  users/
    page.tsx
    UsersTable.tsx
    CreateUserDialog.tsx        # role selector → conditional partner_id field

src/hooks/
  useSessions.ts
  useUsers.ts
```

**CreateUserDialog**:
```
Username:  [                ]
Password:  [                ]
Role:      [ADMIN ▼]
  → nếu PARTNER: Partner: [select partner ▼]
```

**Enabled toggle** trong UsersTable: inline `PUT /api/admin/users/:id` với `{ enabled: !current }`.

**DoD**: Sessions page hiển thị empty state rõ ràng (không lỗi). Users list → tạo user ADMIN OK, tạo user PARTNER với partner_id OK. Chọn role PARTNER mà không chọn partner → validation error. Toggle enabled → instant update.

---

## F09 — Polish + Error Handling

### Phân tích

Sau khi tất cả pages xong, cần đảm bảo UX nhất quán:
1. **Toast notifications**: tất cả mutation success/error → sonner toast.
2. **Loading states**: skeleton khi fetch, disabled button khi submitting.
3. **Empty states**: mọi table đều có empty state rõ ràng.
4. **Error boundary**: `error.tsx` cho mỗi route group.
5. **404 page**: `not-found.tsx`.
6. **Responsive**: sidebar collapse ≤ 768px, table scroll horizontal trên mobile.
7. **Page titles**: `metadata` đúng cho mỗi page.

### DoD

- Tất cả action (create/update/delete) đều có toast success/error.
- F5 trên bất kỳ trang nào không bị lỗi (Server Component render xanh).
- `pnpm build` xanh, không TypeScript error.
- Không có `any` type nào không có comment lý do.

---

## Checklist tổng

| Task | Mô tả | Depends | Size | Status |
|---|---|---|---|---|
| **F01** | Project scaffold + deps + Tailwind v4 + shadcn | — | M | [x] |
| **F02** | NextAuth v5 + login page + middleware + api.ts | F01 | M | [x] |
| **F03** | Admin layout + sidebar + shared components | F02 | M | [x] |
| **F04** | Dashboard: stats cards + timeseries chart | F03 | M | [x] |
| **F05** | Partners CRUD + SMPP accounts + API keys | F03 | L | [x] |
| **F06** | Channels CRUD + Routes CRUD | F03 | M | [x] |
| **F07** | Messages search + detail | F03 | M | [x] |
| **F08** | Sessions (stub) + Users CRUD | F03 | S | [x] |
| **F09** | Polish: toast, error boundary, loading states | F04-F08 | S | [x] |

Size: S=<2h, M=2-4h, L=4-8h

---

## API endpoints dùng trong Admin FE

| Endpoint | Dùng ở | Method |
|---|---|---|
| `/api/admin/auth/login` | F02 login | POST |
| `/api/admin/auth/refresh` | F02 token refresh | POST |
| `/api/admin/auth/logout` | F02 logout | POST |
| `/api/admin/auth/me` | F02 session hydration | GET |
| `/api/admin/stats/overview` | F04 dashboard | GET |
| `/api/admin/stats/timeseries` | F04 chart | GET |
| `/api/admin/partners` (list+create) | F05 | GET, POST |
| `/api/admin/partners/:id` (detail+update+delete) | F05 | GET, PUT, DELETE |
| `/api/admin/partners/:id/smpp-accounts` | F05 | GET, POST, DELETE |
| `/api/admin/partners/:id/api-keys` | F05 | GET, POST, DELETE |
| `/api/admin/channels` (list+create) | F06 | GET, POST |
| `/api/admin/channels/:id` (detail+update+delete) | F06 | GET, PUT, DELETE |
| `/api/admin/channels/:id/test-ping` | F06 | POST |
| `/api/admin/routes` (list+create) | F06 | GET, POST |
| `/api/admin/routes/:id` (update+delete) | F06 | PUT, DELETE |
| `/api/admin/messages` | F07 | GET |
| `/api/admin/messages/:id` | F07 | GET |
| `/api/admin/sessions` | F08 | GET |
| `/api/admin/users` | F08 | GET, POST |
| `/api/admin/users/:id` | F08 | GET, PUT |

---

## Conventions FE (bổ sung `docs/frontend.md`)

- File component: PascalCase (`PartnerCard.tsx`).
- Page: default export `async function XxxPage()` (Server Component), file `page.tsx`.
- Client Component bắt buộc `"use client"` dòng đầu.
- Không fetch trong Client Component lần đầu — Server Component pass `initialData` prop.
- Tất cả type lấy từ `lib/types.ts`, không dùng `any`.
- API mutation dùng `useMutation` từ TanStack Query, không `fetch` trực tiếp trong handler.
- Toast: `import { toast } from "sonner"` — dùng `toast.success`, `toast.error`.
- Ngày giờ hiển thị: `dd/MM/yyyy HH:mm` (locale `vi`), timezone `Asia/Ho_Chi_Minh`.
- Số lớn: `toLocaleString("vi-VN")`.
- Error message từ BE (RFC 7807 `detail`) hiển thị trực tiếp trong toast, không hardcode.
