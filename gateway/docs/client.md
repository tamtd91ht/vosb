# client.md — Tổng quan Frontend VOSB Gateway

> **Mục đích**: Tài liệu reference đầy đủ cho frontend Next.js, dùng làm ngữ cảnh cho Claude Code và dev khi phát triển. Cặp với `server.md` (backend reference).
>
> **Lưu ý quan trọng**: Project dùng **Next.js 16.2.4 + React 19.2.4** — KHÔNG phải Next.js bạn đã quen từ training data. Trước khi viết feature mới đụng API mới (params, cache, server actions, middleware…), **đọc `node_modules/next/dist/docs/01-app/...`** để check pattern hiện tại. File `gateway/frontend/AGENTS.md` cảnh báo điều này.
>
> **Nguyên tắc**: Code tiếng Anh, comment tối thiểu. UI string tiếng Việt (admin/portal đều người Việt). Error message từ API bằng tiếng Anh (RFC 7807 `detail`).

---

## Mục lục

1. [Tổng quan](#1-tổng-quan)
2. [Stack & quyết định kiến trúc](#2-stack--quyết-định-kiến-trúc)
3. [Cấu trúc dự án](#3-cấu-trúc-dự-án)
4. [App Router & route groups](#4-app-router--route-groups)
5. [Authentication (NextAuth v5)](#5-authentication-nextauth-v5)
6. [API client utilities](#6-api-client-utilities)
7. [Type definitions](#7-type-definitions)
8. [Admin pages](#8-admin-pages)
9. [Portal pages](#9-portal-pages)
10. [Layout & common components](#10-layout--common-components)
11. [shadcn/ui components](#11-shadcnui-components)
12. [Styling (Tailwind v4)](#12-styling-tailwind-v4)
13. [Forms, queries, toast](#13-forms-queries-toast)
14. [Build, env, deploy](#14-build-env-deploy)
15. [Next.js 16 quirks](#15-nextjs-16-quirks)
16. [Known gaps & next steps](#16-known-gaps--next-steps)

---

## 1. Tổng quan

Frontend là **single Next.js app** chứa cả **Admin Console** (`/admin/*`, role=ADMIN) và **Partner Portal** (`/portal/*`, role=PARTNER). Cùng codebase, route groups (`(admin)`, `(portal)`) tách layout + auth gate riêng.

```
                           Next.js 16 (App Router, Turbopack)
                          ┌─────────────────────────────────┐
                          │        proxy.ts (auth proxy)    │
                          │   redirect by role / login...   │
                          └────────────┬────────────────────┘
                                       │
                  ┌────────────────────┼────────────────────┐
                  │                    │                    │
              /login              /admin/*             /portal/*
            (public)         (role=ADMIN)         (role=PARTNER)
                                  │                    │
                          AdminSidebar          PortalSidebar
                          AdminTopbar            PortalTopbar
                          + 10 page              + 7 page
                                  │                    │
                                  └────┬───────────────┘
                                       │
                              apiClient/apiServer
                              (lib/api.ts)
                                       │
                                       ▼
                            Backend HTTP API @ 8080
                           (vert.x routers, JWT Bearer)
```

**Đặc điểm chính**:
- Server components mỏng (page.tsx 5–20 dòng) chỉ import metadata + Client component
- Logic UI nằm trong `<Name>Client.tsx` (client component) cùng folder
- TanStack Query v5 cho data fetching + cache + refetch interval
- React Hook Form + Zod cho forms
- shadcn/ui (Radix-based) cho component library
- Tailwind v4 với `@theme inline` CSS variables (oklch color)
- NextAuth v5 (beta) cho session JWT + auto-refresh
- Vietnamese UI, date-fns vi locale

---

## 2. Stack & quyết định kiến trúc

| Layer | Choice | Phiên bản | Lý do |
|---|---|---|---|
| Framework | Next.js | 16.2.4 (App Router, Turbopack) | SSR + Client components, file-based routing |
| Runtime | React | 19.2.4 | RC features ổn định |
| Language | TypeScript | 5 (strict) | Type-safe types mirror BE DTOs |
| Styling | Tailwind CSS | 4 | `@theme inline` + oklch palette |
| UI primitives | Radix UI | latest | Headless, accessible |
| UI wrapper | shadcn/ui | 4.5.0 | Pre-styled Radix wrapper |
| Forms | React Hook Form + Zod | 7.74 + 4.3 | Schema validation + uncontrolled forms |
| Data | TanStack Query | 5.100 | Cache, refetch, mutation |
| Auth | NextAuth | 5.0.0-beta.31 | JWT credentials provider, callbacks |
| HTTP | native `fetch` (wrapper `apiClient`/`apiServer`) | — | Không dùng axios |
| Charts | Recharts | 3.8.1 | AreaChart + BarChart |
| Toast | Sonner | 2.0.7 | Top-right richColors |
| Icons | lucide-react | 1.11.0 | Tree-shakable SVG |
| Date | date-fns | 4.1.0 + vi locale | Format Vietnamese |
| State | Zustand | 5.0.12 | (Có sẵn nhưng chưa dùng — server state qua TanStack đủ) |

### Quyết định
- **KHÔNG dùng axios** — `fetch` native + wrapper `apiClient`/`apiServer` đủ
- **KHÔNG dùng SWR** — TanStack Query thay thế (mutation + invalidation tốt hơn)
- **KHÔNG dùng Zustand cho server state** — TanStack Query là source of truth; Zustand chỉ cho UI state nếu cần
- **Server component cho page wrapper, Client component cho logic** — pattern thuần Next 13+
- **Route groups `(admin)` / `(portal)` không có path segment** — chỉ tách layout/auth gate
- **Auth gate ở 2 nơi**: `proxy.ts` (redirect sớm), `layout.tsx` (server-side double-check `auth()` rồi redirect)

---

## 3. Cấu trúc dự án

```
frontend/
├── package.json
├── next.config.ts                 # output: "standalone"
├── tsconfig.json                  # paths { "@/*": ["./src/*"] }
├── postcss.config.mjs             # plugin: @tailwindcss/postcss
├── eslint.config.mjs              # next/core-web-vitals + typescript
├── components.json                # shadcn config
├── .env.local                     # AUTH_SECRET, API_BASE_INTERNAL, NEXT_PUBLIC_API_BASE
├── CLAUDE.md → AGENTS.md          # Cảnh báo "NOT the Next.js you know"
└── src/
    ├── app/                       # App Router
    │   ├── layout.tsx             # Root: html lang="vi", Providers, Toaster
    │   ├── page.tsx               # Root redirect
    │   ├── globals.css            # @theme inline + oklch palette + sidebar custom vars
    │   ├── login/
    │   │   └── page.tsx           # Server page → <LoginForm />
    │   ├── api/auth/[...nextauth]/route.ts  # NextAuth handlers (GET/POST)
    │   ├── (admin)/
    │   │   └── admin/
    │   │       ├── layout.tsx     # auth gate role=ADMIN, AdminSidebar+Topbar
    │   │       ├── dashboard/{page,DashboardClient}.tsx
    │   │       ├── partners/
    │   │       │   ├── {page,PartnersClient}.tsx
    │   │       │   └── [id]/{page,PartnerDetailClient}.tsx
    │   │       ├── providers/
    │   │       │   ├── {page,ProvidersClient}.tsx
    │   │       │   └── [id]/{page,ProviderDetailClient}.tsx
    │   │       ├── routes/{page,RoutesClient}.tsx
    │   │       ├── messages/
    │   │       │   ├── {page,MessagesClient}.tsx
    │   │       │   └── [id]/page.tsx     # SERVER component (full SSR)
    │   │       ├── sessions/{page,SessionsClient}.tsx
    │   │       ├── users/{page,UsersClient}.tsx
    │   │       └── channels/page.tsx     # redirect("/admin/providers")
    │   └── (portal)/
    │       └── portal/
    │           ├── layout.tsx     # auth gate role=PARTNER, PortalSidebar+Topbar
    │           ├── overview/{page,OverviewClient}.tsx
    │           ├── messages/
    │           │   ├── {page,PortalMessagesClient}.tsx
    │           │   └── [id]/{page,MessageDetailClient}.tsx
    │           ├── api-keys/{page,ApiKeysClient}.tsx
    │           ├── smpp-accounts/{page,SmppAccountsClient}.tsx
    │           ├── webhook/{page,WebhookClient}.tsx
    │           └── docs/{page,DocsClient}.tsx
    ├── components/
    │   ├── providers.tsx          # SessionProvider + QueryClientProvider
    │   ├── auth/LoginForm.tsx
    │   ├── layout/                # AdminSidebar, AdminTopbar, PortalSidebar, PortalTopbar
    │   ├── common/                # PageHeader, ConfirmDialog, EmptyState, StatusBadge
    │   └── ui/                    # shadcn primitives (Radix wrappers)
    ├── lib/
    │   ├── auth.ts                # NextAuth v5 config + callbacks
    │   ├── api.ts                 # apiClient, apiServer, ApiError
    │   ├── types.ts               # Mirror BE DTO types
    │   └── utils.ts               # cn() (clsx + twMerge)
    └── proxy.ts                   # Next 16 Proxy: auth redirect logic
```

### `package.json` scripts

```json
{
  "dev":   "next dev",
  "build": "next build",
  "start": "next start",
  "lint":  "eslint"
}
```

### Path alias
`@/` = `src/` (xem `tsconfig.json`).

---

## 4. App Router & route groups

### Root layout (`src/app/layout.tsx`)
- Server component
- `<html lang="vi" suppressHydrationWarning>`
- Font: Inter (Google Fonts) → CSS var `--font-sans`
- Children wrapped trong `<Providers>` (SessionProvider + QueryClientProvider)
- `<Toaster richColors position="top-right" />` (Sonner) ở ngay trong body

### Providers (`src/components/providers.tsx`)

```tsx
<SessionProvider>
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
</SessionProvider>
```

QueryClient defaults: `staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: false`.

### Proxy (`src/proxy.ts`) — Next.js 16 middleware

47 dòng. Logic:
- Match path: not `/_next/static`, not `/_next/image`, not `/favicon.ico`, not `/api/auth/*`
- Get session via `auth()`
- **Unauthenticated** trên `/admin/*` hoặc `/portal/*` → redirect `/login?callbackUrl=<path>`
- **Authenticated trên `/login`** → redirect theo role:
  - role=ADMIN → `/admin/dashboard`
  - role=PARTNER → `/portal/overview`
- **Role mismatch** (ADMIN vào `/portal` hoặc ngược lại) → redirect tới khu vực đúng

### Auth route (`src/app/api/auth/[...nextauth]/route.ts`)

```ts
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

NextAuth v5 export style — handlers vào dynamic route catch-all.

### Route groups
- `(admin)/admin/*` → tất cả admin page; layout có auth gate ADMIN
- `(portal)/portal/*` → tất cả portal page; layout có auth gate PARTNER

Route group **không** ảnh hưởng URL (dấu ngoặc bị strip).

### Layout `(admin)/admin/layout.tsx` (server)

```tsx
const session = await auth();
if (!session || session.user.role !== "ADMIN") redirect("/login");

return (
  <div className="flex h-screen">
    <AdminSidebar />
    <main className="flex-1 flex flex-col">
      <AdminTopbar />
      <div className="flex-1 overflow-y-auto p-6">{children}</div>
    </main>
  </div>
);
```

Tương tự cho `(portal)/portal/layout.tsx` với role=PARTNER + `PortalSidebar/PortalTopbar`.

### Pattern page mỏng + Client component

Server `page.tsx`:
```tsx
import { Metadata } from "next";
import { PageHeader } from "@/components/common/PageHeader";
import { PartnersClient } from "./PartnersClient";

export const metadata: Metadata = { title: "Đối tác — VOSB Gateway" };

export default function PartnersPage() {
  return (
    <div>
      <PageHeader title="Đối tác" description="..." />
      <PartnersClient />
    </div>
  );
}
```

Client `PartnersClient.tsx` chứa toàn bộ logic, hooks, UI. Pattern này áp dụng đồng nhất cho mọi route trừ `messages/[id]` admin (dùng `apiServer` SSR).

### Dynamic params (Next.js 16)

Next.js 16 dùng **async params (`Promise<...>`)**, page component phải `async` + `await params`:

```tsx
export default async function PartnerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PartnerDetailClient id={Number(id)} />;
}
```

**Bug đã gặp**: nếu khai báo sync `params: { id: string }` rồi `Number(params.id)` → ra `NaN` (vì `params` thực tế là Promise, `.id` trả undefined). Tất cả 4 dynamic page (`partners/[id]`, `providers/[id]`, admin & portal `messages/[id]`) đã được fix sang async pattern. **Mọi `[id]/page.tsx` mới phải dùng async pattern.**

---

## 5. Authentication (NextAuth v5)

### `src/lib/auth.ts`

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      async authorize(credentials) {
        // POST /api/admin/auth/login
        // GET /api/admin/auth/me
        // return { id, name, role, partnerId, accessToken, refreshToken, expiresAt }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      // 1. On signin: copy from user to token
      // 2. Auto-refresh: nếu Date.now() > token.expiresAt - 5*60*1000
      //    → POST /api/admin/auth/refresh
      //    → update token.accessToken, token.expiresAt
      //    → on fail: token.error = "refresh_failed"
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      session.user = { id, name, role, partnerId };
      session.error = token.error;
      return session;
    }
  }
});
```

### Module augmentation

```ts
declare module "next-auth" {
  interface Session {
    accessToken: string;
    user: { id: string; name: string; role: AdminRole; partnerId: number | null };
    error?: string;
  }
  interface User {
    role: AdminRole;
    partnerId: number | null;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    role: AdminRole;
    partnerId: number | null;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    error?: string;
  }
}
```

### `LoginForm.tsx`

- Zod schema: `{ username: min 1, password: min 1 }`
- `signIn("credentials", { username, password, redirect: false })`
- Success → `router.push("/admin/dashboard")` + `router.refresh()` (proxy sẽ redirect đúng role)
- Failure → toast "Tên đăng nhập hoặc mật khẩu không đúng"
- Show/hide password toggle (Eye/EyeOff icon)

### Token attachment

Client component lấy token từ `useSession()`:
```ts
const { data: session } = useSession() as { data: any };
const token = session?.accessToken as string | undefined;
// pass to apiClient(token, ...)
```

Server component dùng `apiServer(...)` — tự gọi `auth()` internally để lấy token.

### Logout

`AdminTopbar` / `PortalTopbar` user dropdown có item Đăng xuất:
```ts
signOut({ callbackUrl: "/login" });
```
Clear NextAuth cookies, redirect login.

### Refresh token failure

Khi `error: "refresh_failed"` xuất hiện trong session, UI có thể detect và force re-login. Hiện tại chưa có handler tự động — user sẽ thấy 401 ở next API call và phải login lại.

---

## 6. API client utilities

### `src/lib/api.ts`

```ts
type ApiOpts = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  token?: string;
};

class ApiError extends Error {
  status: number;
  detail: string;
}
```

#### `apiServer(path, opts)` — server-side
- Gọi `auth()` để lấy token
- Base URL: `process.env.API_BASE_INTERNAL ?? "http://localhost:8080"` (dùng cho server-to-server, có thể là Docker internal name)
- `cache: "no-store"` (không cache giữa các request)

#### `apiClient(token, path, opts)` — client-side
- Token truyền explicit (từ `useSession()`)
- Base URL: `process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080"` (browser-accessible)

#### Error handling
Cả hai parse response 4xx/5xx:
```ts
detail = body.detail || body.title || statusText;
throw new ApiError(status, detail);
```

#### Query string
`buildUrl()` filter `undefined`, `null`, `""` để tránh ghi `?state=`.

### Sử dụng với TanStack Query

```ts
const { data, isLoading } = useQuery<PageResponse<Partner>>({
  queryKey: ["partners", page],
  queryFn: () => apiClient(token, "/api/admin/partners", { query: { page, size: 20 } }),
  enabled: !!token,
});

const createMutation = useMutation({
  mutationFn: (body) => apiClient(token, "/api/admin/partners", { method: "POST", body }),
  onSuccess: () => {
    toast.success("Tạo thành công");
    qc.invalidateQueries({ queryKey: ["partners"] });
  },
  onError: (err) => toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi"),
});
```

---

## 7. Type definitions

`src/lib/types.ts` — tất cả mirror BE response (snake_case JSON, ánh xạ tới TS field cùng tên).

### Pagination
```ts
type PageResponse<T> = { items: T[]; total: number; page: number; size: number };
```

### Partner domain
```ts
type Partner = {
  id: number; code: string; name: string;
  status: "ACTIVE" | "SUSPENDED";
  dlr_webhook: DlrWebhook | null;
  balance: number;
  created_at: string; updated_at: string;
};

type PartnerSmppAccount = {
  id: number; partner_id: number;
  system_id: string; max_binds: number; ip_whitelist: string[];
  status: "ACTIVE" | "DISABLED"; created_at: string;
};

type PartnerApiKey = {
  id: number; key_id: string; label: string;
  status: "ACTIVE" | "REVOKED";
  last_used_at: string | null; created_at: string;
};

type PartnerRate = {
  id: number; partner_id: number;
  delivery_type: DeliveryType;
  carrier: Carrier | null; prefix: string;
  rate: number; currency: string; unit: RateUnit;
  effective_from: string; effective_to: string | null;
  created_at: string;
};
```

### Channel / Provider
```ts
type ChannelType = "HTTP_THIRD_PARTY" | "FREESWITCH_ESL" | "TELCO_SMPP";
type ChannelStatus = "ACTIVE" | "DISABLED";
type DeliveryType = "SMS" | "VOICE_OTP";
type RateUnit = "MESSAGE" | "SECOND" | "CALL";
type Carrier = "VIETTEL" | "MOBIFONE" | "VINAPHONE" | "VIETNAMOBILE" | "GMOBILE" | "REDDI";

type CarrierInfo = { code: Carrier; name: string; prefixes: string[] };

type Channel = {
  id: number; code: string; name: string;
  type: ChannelType; delivery_type: DeliveryType;
  config: Record<string, unknown>;
  status: ChannelStatus;
  created_at: string; updated_at: string;
};

type ChannelRate = {
  id: number; channel_id: number;
  carrier: Carrier | null; prefix: string;
  rate: number; currency: string; unit: RateUnit;
  effective_from: string; effective_to: string | null;
  created_at: string;
};

type ChannelStats = {
  period: string;
  total: number; delivered: number; failed: number;
  delivery_rate: number;
  by_state: Record<string, number>;
};

type HttpProviderField = {
  key: string; label: string; type: string;
  required: boolean; defaultValue: string | null; hint: string | null;
};
type HttpProvider = {
  code: string; name: string;
  delivery_type: DeliveryType;
  fields: HttpProviderField[];
};
```

### Routing
```ts
type Route = {
  id: number; partner_id: number;
  carrier: string | null; msisdn_prefix: string;
  channel_id: number; fallback_channel_id: number | null;
  priority: number; enabled: boolean; created_at: string;
};
```

### Message
```ts
type MessageState = "RECEIVED" | "ROUTED" | "SUBMITTED" | "DELIVERED" | "FAILED";
type Message = {
  id: string; partner_id: number; channel_id: number | null;
  source_addr: string; dest_addr: string; content: string;
  encoding: "GSM7" | "UCS2" | "LATIN1";
  inbound_via: "SMPP" | "HTTP";
  state: MessageState;
  message_id_telco: string | null;
  error_code: string | null;
  created_at: string; updated_at: string;
};
```

### Stats
```ts
type StatsOverview = Record<MessageState, number>;
type TimeseriesPoint = { bucket: string; state: MessageState; count: number };
type TimeseriesResponse = {
  granularity: "hour" | "day"; from: string; to: string;
  series: TimeseriesPoint[];
};
```

### Admin / Session / Webhook
```ts
type AdminRole = "ADMIN" | "PARTNER";
type AdminUser = {
  id: number; username: string; role: AdminRole;
  partner_id: number | null; enabled: boolean;
  last_login_at: string | null; created_at: string;
};

type SmppSession = {
  session_id: string; system_id: string;
  bind_type: string; remote_ip: string; bound_at: string;
};

type DlrWebhook = {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
};
```

---

## 8. Admin pages

10 page admin. Pattern: `page.tsx` (server) + `<Name>Client.tsx` (client).

### `/admin/dashboard` — `DashboardClient.tsx` (434 LOC)
- **3 query**: `stats/overview`, `stats/timeseries` (granularity by range), recent messages 8 row
- **Toggle range**: today / 7d / 30d
- **4 KPI card**: total, delivery_rate, failed, in-flight (tổng các state non-terminal)
- **AreaChart Recharts**: stacked DELIVERED (emerald) / SUBMITTED (indigo) / FAILED (red), gradient linearGradient
- **Recent messages table**: id (8 char trunc), source/dest, state badge, time

### `/admin/partners` — `PartnersClient.tsx` (390 LOC)
- Paginated 20/page
- **Create dialog**: Zod `{ code: required, name: required, dlr_url: url|empty, dlr_method: GET|POST|PUT|PATCH }`
- POST `/api/admin/partners` — body `{ code, name, dlr_webhook: {url, method} | undefined }`
- DELETE = soft suspend, có ConfirmDialog
- Table cột: code (mono badge), name, status badge, balance (VND format), created_at, "Xem" link

### `/admin/partners/[id]` — `PartnerDetailClient.tsx` (1399 LOC) — **LỚN nhất**
4 tabs:

#### Tab Info
- Update form: name, DLR webhook (url + method)
- Toggle status ACTIVE/SUSPENDED (PUT)

#### Tab SMPP
- List partner_smpp_account
- Create dialog: `{ system_id (≥1), password (≥6), max_binds (int ≥1), ip_whitelist (comma-string) }`
- DELETE soft (status=DISABLED)
- BE chưa hỗ trợ PUT — không edit được max_binds/ip_whitelist (phải xóa+tạo)

#### Tab API Keys
- List partner_api_key (không trả secret)
- Create dialog: `{ label? }` → response `{ key_id, raw_secret, label }`
- Modal hiển thị raw_secret 1 lần (Eye/EyeOff toggle + CopyButton)
- Revoke (DELETE) với ConfirmDialog

#### Tab Rates
- Filter: `delivery_type` (SMS/VOICE_OTP) tabs
- Toggle mode: domestic (carrier select) vs international (prefix input)
- CRUD đầy đủ: create/edit/delete; PUT support cho edit
- Carrier list từ `GET /api/admin/carriers`

### `/admin/providers` — `ProvidersClient.tsx` (875 LOC)
- 3-step create dialog:
  1. Category: SMS | VOICE_OTP
  2. Subtype: TELCO_SMPP / HTTP_SMS / FREESWITCH_ESL / HTTP_VOICE
  3. Config form (Zod schema khác nhau theo subtype)
- HTTP provider field render dynamic từ `GET /api/admin/channels/http-providers` (template metadata)
- Card grid layout: type icon, type badge, status badge, link "Xem chi tiết"

### `/admin/providers/[id]` — `ProviderDetailClient.tsx` (1128 LOC)
3 tabs:

#### Tab Cấu hình
- Hiển thị info channel (code, name, type, delivery_type, status, created_at)
- Config JSON pretty-print
- 3 nút action:
  - **Test ping** (POST `/test-ping`, hiển thị toast — Phase 2 stub)
  - **Sửa** (mở dialog chỉnh name + delivery_type + config JSON)
  - **Vô hiệu hóa / Kích hoạt** (toggle status)

#### Tab Thống kê
- Period filter: 1d / 7d / 30d
- Query `GET /channels/:id/stats?period=`
- 4 KPI card: total, delivered, failed, delivery_rate %
- BarChart by_state (DELIVERED green, FAILED red, others indigo)

#### Tab Bảng giá
- Channel rate CRUD đầy đủ (carrier vs prefix toggle, edit, delete)
- Currency VND/USD, Unit MESSAGE/SECOND/CALL, effective_from/to date

### `/admin/routes` — `RoutesClient.tsx` (gần 600 LOC sau cập nhật)
- Paginated 20/page
- Match mode: carrier (select 6 nhà mạng) | prefix (input msisdn_prefix)
- CRUD đầy đủ: create + edit (dialog reuse, partner read-only khi edit) + delete + toggle enabled (Switch)
- Mutation `PUT` với body include carrier/msisdn_prefix mutually exclusive (set 1, null 1)

### `/admin/messages` — `MessagesClient.tsx` (243 LOC)
- Paginated 20/page
- Filter: partner_id (input), state (select), dest_addr (input)
- Apply button + Enter key
- Table: id (8 char), source, dest, content (40 char trunc), state badge, inbound_via badge, time, "Xem" link

### `/admin/messages/[id]/page.tsx` — **SERVER COMPONENT** (191 LOC)
- Async server component, dùng `apiServer()` để fetch
- Layout 2 cột: main info + timeline
- Timeline: visual step (RECEIVED → ROUTED → SUBMITTED → DELIVERED) hoặc separate FAILED step
- Khác pattern: tất cả page khác là client; chỉ message detail admin là server (hiệu năng + SEO không cần)

### `/admin/users` — `UsersClient.tsx` (430 LOC)
- Paginated 20/page
- Create dialog: `{ username (≥3), password (≥8), role (ADMIN|PARTNER), partner_id (conditional khi role=PARTNER) }`
- Edit dialog: `{ password? (≥8 nếu có), enabled }`
- Mutation: POST + PUT (no DELETE — disable bằng `enabled=false`)
- Table: username, role badge, partner code (nếu PARTNER), enabled (Switch), last_login_at, created_at, "Sửa"

### `/admin/sessions` — `SessionsClient.tsx` (mới, ~165 LOC)
- **refetchInterval: 5000** (live update mỗi 5s)
- Table: system_id (mono badge), bind_type badge (RX=blue, TX=violet, TRX=emerald), remote_ip, session_id (truncated), bound_at (HH:mm:ss)
- Kick button + ConfirmDialog → `DELETE /api/admin/sessions/:id`
- Footer: "Tự động làm mới mỗi 5 giây · Tổng N phiên đang bind"
- EmptyState: "Không có phiên SMPP"

### `/admin/channels` — chỉ `redirect("/admin/providers")`
File `page.tsx` 5 dòng, không có client component (đã xóa `ChannelsClient.tsx` 425 dòng dead code).

---

## 9. Portal pages

7 page portal cho self-service partner.

### `/portal/overview` — `OverviewClient.tsx` (182 LOC)
- 2 query: `/api/portal/overview`, `/api/portal/messages?page=0&size=6`
- 4 KPI: balance (VND format), total messages, delivery_rate %, failed count
- 2 col grid: state breakdown chart + recent 6 message
- Show partner name + code

### `/portal/messages` — `PortalMessagesClient.tsx` (149 LOC)
- Paginated 20/page
- Filter: state (select), dest_addr (input)
- Skeleton loading row
- IDOR-safe (BE filter theo `partnerId` từ JWT)

### `/portal/messages/[id]` — `MessageDetailClient.tsx` (115 LOC)
- Client component (khác admin message detail dùng SSR)
- Timeline left + detail right
- State color coding: pre-delivery=blue, DELIVERED=green, FAILED=red

### `/portal/api-keys` — `ApiKeysClient.tsx` (199 LOC)
- Self-service: tạo + revoke key của chính partner
- Reveal raw_secret modal sau create (Eye/EyeOff + CopyButton, 1 lần duy nhất)
- POST `/api/portal/api-keys`, POST `/api/portal/api-keys/:id/revoke`

### `/portal/smpp-accounts` — `SmppAccountsClient.tsx` (137 LOC)
- Read-only list (system_id, max_binds, ip_whitelist join, status)
- Action duy nhất: Đổi password
- Dialog: `{ new_password (≥8), confirm (must match) }`
- Info banner: các config khác phải liên hệ admin

### `/portal/webhook` — `WebhookClient.tsx` (152 LOC)
- Form: URL (required), method select (GET/POST/PUT/PATCH), dynamic headers (key-value rows + add/remove)
- Info box: explain DLR JSON payload
- Mutation `PATCH /api/portal/webhook` với body `{ dlr_webhook: { url, method, headers } }`
- Cancel = reset từ overview state

### `/portal/docs` — `DocsClient.tsx` (172 LOC)
- Static guide (no API call)
- Section: Overview / HTTP API auth (HMAC SHA-256 example) / SMPP code samples / Response examples / Error codes
- CodeBlock helper với syntax highlight + CopyButton

---

## 10. Layout & common components

### `AdminSidebar.tsx`
- Width 64 (`w-64 flex-shrink-0`)
- Bg: `#0a0f23` (dark navy custom)
- Logo: Zap icon trong indigo-600 box + "VOSB Gateway" + "Admin Console"
- Status: green pulse + "System Online"
- 7 nav items: Dashboard, Partners, Providers, Routes, Messages, Sessions, Users (ADMIN only)
- Active style: bg `indigo-600/15`, text `indigo-300`, ChevronRight icon
- `usePathname()` detect current route

### `PortalSidebar.tsx`
- Width 64, bg white + border-r slate-100
- Logo: Zap sky-600 box + "VOSB Gateway" + "Partner Portal"
- 6 nav items: Overview, Messages, API Keys, SMPP Accounts, Webhook, Docs
- Active style: bg `sky-50`, text `sky-700`
- Footer: version "v0.1.0-phase-2"

### `AdminTopbar.tsx` / `PortalTopbar.tsx`
- Height 16, bg white, border-b
- Left: dot indicator + label
- Right: Bell (notification placeholder), user dropdown (avatar w-7 h-7 với initial, name, ChevronDown)
- Dropdown items: Hồ sơ (placeholder), Cài đặt (placeholder), Đăng xuất (`signOut({ callbackUrl: "/login" })`)

### `src/components/common/`

#### `PageHeader`
```ts
type Props = { title: string; description?: string; action?: ReactNode };
```
- Layout flex-between, h1 text-2xl bold, p text-sm gray-500

#### `ConfirmDialog`
```ts
type Props = {
  open: boolean; onClose: () => void; onConfirm: () => void;
  loading?: boolean;
  title: string; description?: string;
  confirmLabel?: string; // default "Xác nhận"
  variant?: "destructive" | "default"; // default "destructive"
};
```
- Wrapper cho Radix Dialog
- Confirm button đỏ nếu destructive, có Loader2 khi loading

#### `EmptyState`
```ts
type Props = { icon: LucideIcon; title: string; description?: string; action?: ReactNode };
```
- Icon trong rounded box bg-gray-100
- Centered title + description + optional action button

#### `StatusBadge`
```ts
type Props = { status: string };
```
- Map status → `{ label (Vietnamese), className }`
- Predefined: ACTIVE (emerald), SUSPENDED (amber), DISABLED (gray), REVOKED (red), MessageState colors, ADMIN (violet), PARTNER (blue)
- Fallback gray nếu không map

---

## 11. shadcn/ui components

`src/components/ui/`:

| File | Component | Wrapper of |
|---|---|---|
| `avatar.tsx` | Avatar, AvatarImage, AvatarFallback | @radix-ui/react-avatar |
| `badge.tsx` | Badge (CVA variants) | — (custom) |
| `button.tsx` | Button (CVA: default/outline/ghost/destructive × sm/md/lg/icon) | @radix-ui/react-slot |
| `card.tsx` | Card, CardHeader, CardTitle, CardContent, CardDescription | — (custom) |
| `dialog.tsx` | Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter | @radix-ui/react-dialog |
| `dropdown-menu.tsx` | DropdownMenu + Trigger/Content/Item/Separator/Label | @radix-ui/react-dropdown-menu |
| `input.tsx` | Input (h-9 default) | — (native) |
| `label.tsx` | Label | @radix-ui/react-label |
| `popover.tsx` | Popover, PopoverTrigger, PopoverContent | @radix-ui/react-popover |
| `progress.tsx` | Progress | @radix-ui/react-progress |
| `select.tsx` | Select + Trigger/Value/Content/Item/Group/Label | @radix-ui/react-select |
| `separator.tsx` | Separator | @radix-ui/react-separator |
| `skeleton.tsx` | Skeleton (loading placeholder) | — (custom) |
| `sonner.tsx` | Toaster | sonner |
| `switch.tsx` | Switch | @radix-ui/react-switch |
| `tabs.tsx` | Tabs, TabsList, TabsTrigger, TabsContent | @radix-ui/react-tabs |
| `tooltip.tsx` | Tooltip + Trigger/Content | @radix-ui/react-tooltip |
| `table.tsx` | Table, TableHeader, TableBody, TableRow, TableCell, TableHead | — (custom) |

### `lib/utils.ts`

```ts
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Dùng khắp nơi để merge Tailwind classes có conflict (e.g. `cn("bg-red-500", isActive && "bg-blue-500")` → blue).

---

## 12. Styling (Tailwind v4)

### `src/app/globals.css`

Cấu trúc:
```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@theme inline {
  --color-background: oklch(1 0 0);
  --color-foreground: oklch(0.129 0.042 264.695);
  --color-primary: oklch(0.497 0.224 264.376);  /* indigo-600 */
  --color-primary-foreground: oklch(0.985 0 0);
  /* ... */

  /* Sidebar custom theme */
  --color-sidebar: oklch(0.039 0.078 264.695);  /* dark navy */
  --color-sidebar-active-bg: oklch(0.497 0.224 264.376 / 0.15);
  --color-sidebar-text: oklch(0.985 0 0);
  /* ... */

  /* Radius scale */
  --radius: 0.625rem;
  --radius-sm: calc(var(--radius) * 0.6);
  --radius-md: calc(var(--radius) * 0.8);
  --radius-lg: calc(var(--radius) * 1.0);
  /* ... */
}

.dark { /* dark mode overrides */ }

@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground font-sans; }
}
```

### Brand colors
- **Primary admin**: indigo-600 (`oklch(0.497 0.224 264.376)`)
- **Primary portal**: sky-600
- **Success**: emerald-500/600
- **Destructive**: red-500/600
- **Warning**: amber-500/600
- **Neutral**: slate (most), gray (legacy)

### Conventions
- Card: `border-0 shadow-sm bg-white` (clean, no border)
- Table header: `text-xs font-semibold text-gray-500 uppercase tracking-wide`
- Table cell: `text-sm`
- Button primary admin: `bg-indigo-600 hover:bg-indigo-500 text-white`
- Button primary portal: `bg-sky-600 hover:bg-sky-500 text-white`
- Status badge: small + colored bg + matching border (e.g. `bg-emerald-50 text-emerald-700 border-emerald-200`)

---

## 13. Forms, queries, toast

### Forms (React Hook Form + Zod)

Pattern chuẩn:
```tsx
const schema = z.object({
  code: z.string().min(1, "Bắt buộc"),
  name: z.string().min(1, "Bắt buộc"),
  email: z.string().email("Email không hợp lệ").optional(),
});

const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } =
  useForm<FormType>({
    resolver: zodResolver(schema) as any,
    defaultValues: {...},
  });

const onSubmit = (data: FormType) => mutation.mutate(data);

<form onSubmit={handleSubmit(onSubmit)}>
  <Input {...register("code")} />
  {errors.code && <p className="text-red-500 text-xs">{errors.code.message}</p>}
  <Button type="submit" disabled={isSubmitting || mutation.isPending}>
    {mutation.isPending && <Loader2 className="animate-spin mr-2" />}
    Lưu
  </Button>
</form>
```

### Select (Radix) + RHF
Select không tích hợp với RHF native — dùng `setValue("field", value)` trong `onValueChange`:
```tsx
<Select onValueChange={(v) => setValue("partner_id", Number(v))}>
  <SelectTrigger><SelectValue placeholder="..." /></SelectTrigger>
  <SelectContent>
    {partners.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
  </SelectContent>
</Select>
```

Trong edit dialog, dùng `defaultValue` + `key` prop trên Dialog để remount khi target đổi:
```tsx
<Dialog key={editTarget?.id ?? "create"}>
  <Select defaultValue={editTarget?.value}>...
</Dialog>
```

### Queries (TanStack Query v5)

```tsx
const { data, isLoading } = useQuery<T>({
  queryKey: ["partners", page, filterState],
  queryFn: () => apiClient(token, "/api/...", { query: { page, ... } }),
  enabled: !!token,
  refetchInterval: 5000, // optional cho live data
  staleTime: 30_000,     // default từ QueryClient
});
```

QueryKey convention: `[entity, scope, params]` — dễ invalidate selective:
```ts
qc.invalidateQueries({ queryKey: ["partners"] });            // tất cả partners
qc.invalidateQueries({ queryKey: ["partner", id, "rates"] }); // chỉ rates của partner đó
```

### Mutations
```tsx
const mutation = useMutation({
  mutationFn: (body) => apiClient(token, "/api/...", { method: "POST", body }),
  onSuccess: (data) => {
    toast.success("Thành công");
    qc.invalidateQueries({ queryKey: ["..."] });
  },
  onError: (err) => toast.error(err instanceof ApiError ? err.detail : "Đã xảy ra lỗi"),
});
```

### Toast (Sonner)
```ts
toast.success("Tạo thành công");
toast.error("Lỗi: ...");
toast.warning("Cảnh báo");
toast.info("Thông tin");
toast.message("Test ping", { description: "Phase 2 stub" });
```
Mounted ở root layout với `richColors position="top-right"`.

### Date format (date-fns vi)
```ts
import { format } from "date-fns";
import { vi } from "date-fns/locale";

format(new Date(iso), "dd/MM/yyyy HH:mm", { locale: vi });
format(new Date(iso), "HH:mm", { locale: vi }); // chart axis tick
format(new Date(iso), "dd/MM HH:mm:ss", { locale: vi }); // session list
```

### Charts (Recharts)
```tsx
<ResponsiveContainer width="100%" height={240}>
  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
    <XAxis dataKey="state" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
    <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }} />
    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
      {chartData.map((entry, i) => <Cell key={i} fill={barFill(entry.state)} />)}
    </Bar>
  </BarChart>
</ResponsiveContainer>
```

---

## 14. Build, env, deploy

### Commands

```bash
npm run dev    # next dev (Turbopack)
npm run build  # next build → .next/standalone/
npm run start  # next start
npm run lint   # eslint
```

### Environment variables (`.env.local`)

```bash
# NextAuth
AUTH_SECRET=<min 32 chars random>
AUTH_TRUST_HOST=true

# API base URL
API_BASE_INTERNAL=http://localhost:8080      # server-side fetch (Docker internal name in prod)
NEXT_PUBLIC_API_BASE=http://localhost:8080   # client-side fetch (browser-accessible)
```

**Quan trọng**:
- `NEXT_PUBLIC_*` được inline vào client bundle tại build time → đổi giá trị phải rebuild
- `AUTH_SECRET` xài để sign NextAuth JWT cookie → khác `APP_JWT_SECRET` của BE (BE dùng key riêng cho access/refresh token nó issue)
- Trong prod, `NEXT_PUBLIC_API_BASE` thường là URL public Nginx-proxied (e.g. `https://api.vosb.example.com`)

### Build output
`next.config.ts` set `output: "standalone"` → `.next/standalone/server.js` self-contained, deploy được vào Docker scratch image hoặc Node host.

```dockerfile
# Production Dockerfile (mẫu)
FROM node:20-alpine AS deps
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
COPY . .
COPY --from=deps node_modules ./node_modules
RUN npm run build

FROM node:20-alpine AS runner
ENV NODE_ENV=production
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### Production deployment notes
- Frontend chạy trên port 3000 (Next default)
- Nginx (host) reverse proxy 443/80 → :3000 + 443 → :8080 (BE)
- Single domain hay subdomain tách biệt: tham chiếu `gateway/docs/nginx.md`
- Tránh expose `_next/static` qua CDN trừ khi đã optimize (xem Next.js docs)

---

## 15. Next.js 16 quirks

`gateway/frontend/CLAUDE.md` → `AGENTS.md`:
> **This is NOT the Next.js you know.**
> APIs, conventions, and file structure may differ from training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code.

### Đã biết khác Next 14/15

| Feature | Next 14/15 | Next 16 (project hiện tại) |
|---|---|---|
| Dynamic params | sync (14) → async Promise (15) | **async Promise** (giống Next 15) — page phải `async` + `await params` |
| Middleware | `middleware.ts` | **`proxy.ts`** (đổi tên) |
| Turbopack | flag `--turbo` | mặc định cho `next dev` |
| Cache strategy | `cache: "default"` | (cần verify, hiện code dùng `cache: "no-store"`) |
| `params: { id: string }` | sync (14) | **`Promise<{ id: string }>`** — `await params` BẮT BUỘC, nếu không sẽ ra NaN/undefined |

### Khi cần feature Next 16 mới
1. Đọc `gateway/frontend/node_modules/next/dist/docs/01-app/` (tổ chức theo: api/architecture/community)
2. KHÔNG copy pattern từ Next 14/15 documentation cũ
3. Test với `npm run dev` rồi `npm run build` trước khi commit

### React 19 features sử dụng
- `useActionState` (form actions) — chưa dùng
- `use(promise)` — chưa dùng
- React Compiler: project có warning từ ESLint plugin `react-hooks/incompatible-library` cho RHF `watch()` — đã chấp nhận, không phải lỗi nghiêm trọng

---

## 16. Known gaps & next steps

### Đã có
- ✅ Login + auto-refresh JWT
- ✅ Admin Console: dashboard, partners (CRUD + sub-resources), providers (CRUD + tabs), routes (CRUD), messages (read), sessions (live + kick), users (CRUD)
- ✅ Partner Portal: overview, messages, api-keys, smpp-accounts, webhook, docs
- ✅ Carrier-based routing UI + pricing UI (channel rates, partner rates)
- ✅ Test ping button (BE stub Phase 2)

### Chưa có (placeholder hoặc thiếu)
- **Profile / Settings page** trong AdminTopbar / PortalTopbar — menu item có nhưng route chưa implement
- **Admin top-up balance** — BE chưa expose endpoint, FE không có UI
- **Bulk operations** trên `/admin/messages` (export, retry)
- **Test webhook button** ở `/portal/webhook` — chưa có
- **Real-time DLR feed** (websocket / SSE) — chưa có (cần BE support trước)
- **i18n** — UI Vietnamese hardcode, chưa có English fallback

### Đã dọn (không cần thêm)
- ✅ `ChannelsClient.tsx` 425 dòng dead code đã xóa (`/admin/channels` chỉ redirect)
- ✅ `/admin/sessions` placeholder đã thay bằng full implementation

### Cải thiện đề xuất (Phase 5+)
1. **WebSocket/SSE**: live message stream cho dashboard (thay refetch interval)
2. **Optimistic update**: TanStack Query mutation `onMutate` để UI update trước khi BE confirm
3. **Error boundary**: Next.js `error.tsx` per route group thay vì toast cho lỗi nghiêm trọng
4. **Loading states**: Next.js `loading.tsx` (skeleton page) thay vì in-component skeleton
5. **Type generation**: dùng `openapi-typescript` hoặc tương tự để auto-gen types từ OpenAPI spec của BE, tránh drift `lib/types.ts` vs entity BE
6. **i18n**: nếu cần serve partner quốc tế, thêm `next-intl` hoặc tương đương
7. **E2E tests**: Playwright cho golden flow (login → create partner → submit message → see DLR)

---

## Quick navigation

- Backend reference: `gateway/docs/server.md`
- API spec chi tiết: `gateway/docs/api.md`
- Tiến độ frontend: tham chiếu git log, không có plan riêng
- UI screenshot / design: (chưa có figma link)
- Rules cho Claude khi sửa FE: `.claude/rules/code-language.md` (UI Vietnamese, code English)
- Stack warning: `gateway/frontend/AGENTS.md` (Next 16 != training data)
- Component library: shadcn/ui docs (https://ui.shadcn.com), nhưng các component đã được customize theo `globals.css` palette
