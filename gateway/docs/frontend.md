# Frontend — Next.js 15 (App Router)

1 codebase Next.js, 2 role: **admin** (operator nội bộ) và **portal** (đối tác). Route theo role sau login.

---

## 1. Stack chi tiết

| Layer | Choice | Note |
|---|---|---|
| Runtime | Node 22 LTS | Cho `next start` |
| Framework | Next.js 15 (App Router) | Server Components by default |
| Language | TypeScript 5 | strict mode |
| Style | Tailwind CSS v4 | + CSS variables cho theme |
| UI library | shadcn/ui | Radix + Tailwind, copy components vào repo |
| Auth | NextAuth (Auth.js v5) | Credentials provider gọi BE login |
| State server | TanStack Query v5 | Async data, cache, refetch |
| State UI | Zustand | Global UI (sidebar, theme), tránh prop drilling |
| Form | React Hook Form + Zod | Validation, type-safe |
| HTTP client | fetch native + wrapper `lib/api.ts` | Auto-attach token, error mapping |
| Chart | Recharts | Dashboard timeseries |
| Table | TanStack Table v8 | Headless, integrate với shadcn |
| Date | date-fns + date-fns/locale/vi | Timezone Asia/Ho_Chi_Minh |
| Package manager | pnpm | Lock chặt hơn npm |

---

## 2. Cấu trúc thư mục

```
smpp/frontend/
├── package.json
├── pnpm-lock.yaml
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json                # shadcn/ui config
├── Dockerfile                     # multi-stage: deps → build → runner
├── .dockerignore
├── .env.example
├── public/
│   └── favicon.ico
└── src/
    ├── middleware.ts              # role-based route guard
    ├── app/
    │   ├── layout.tsx             # root layout: Providers (Query, Auth, Toast)
    │   ├── globals.css            # Tailwind base + CSS vars
    │   ├── page.tsx               # redirect theo role hoặc /login
    │   ├── login/
    │   │   └── page.tsx
    │   ├── (admin)/
    │   │   └── admin/
    │   │       ├── layout.tsx     # sidebar + topbar admin, guard role=ADMIN
    │   │       ├── dashboard/page.tsx
    │   │       ├── partners/
    │   │       │   ├── page.tsx          # list + create
    │   │       │   └── [id]/
    │   │       │       ├── page.tsx       # detail
    │   │       │       ├── smpp-accounts/page.tsx
    │   │       │       ├── api-keys/page.tsx
    │   │       │       └── routes/page.tsx
    │   │       ├── channels/
    │   │       │   ├── page.tsx
    │   │       │   ├── new/page.tsx       # form create theo type
    │   │       │   └── [id]/page.tsx
    │   │       ├── routes/page.tsx        # all routes (cross-partner)
    │   │       ├── messages/page.tsx      # search + filter
    │   │       ├── messages/[id]/page.tsx # detail + DLR history
    │   │       └── sessions/page.tsx      # active SMPP binds
    │   ├── (portal)/
    │   │   └── portal/
    │   │       ├── layout.tsx     # sidebar portal, guard role=PARTNER
    │   │       ├── overview/page.tsx
    │   │       ├── messages/page.tsx
    │   │       ├── messages/[id]/page.tsx
    │   │       ├── api-keys/page.tsx      # tạo/rotate
    │   │       ├── smpp-accounts/page.tsx # readonly + change password
    │   │       ├── webhook/page.tsx       # set DLR webhook URL
    │   │       └── docs/page.tsx          # API doc + curl sample
    │   └── api/
    │       └── auth/[...nextauth]/route.ts
    ├── components/
    │   ├── ui/                     # shadcn (button, dialog, input, ...)
    │   ├── data-table/             # bảng tái sử dụng
    │   ├── nav/                    # Sidebar, Topbar
    │   ├── forms/                  # form helper components
    │   └── charts/                 # ChartCard, TimeseriesChart
    ├── lib/
    │   ├── auth.ts                 # NextAuth config + types
    │   ├── api.ts                  # apiFetch() wrapper
    │   ├── schemas.ts              # Zod schemas (Partner, Channel, ...)
    │   ├── types.ts                # TS types từ schemas
    │   └── utils.ts                # cn(), formatDate, etc.
    └── hooks/
        ├── usePartners.ts          # TanStack Query hooks
        ├── useChannels.ts
        ├── useRoutes.ts
        ├── useMessages.ts
        └── useApiKeys.ts
```

---

## 3. Auth flow

### 3.1 NextAuth credentials provider

`src/lib/auth.ts`:

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: { username: {}, password: {} },
      async authorize(creds) {
        const r = await fetch(`${process.env.API_BASE_INTERNAL}/api/admin/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(creds),
        });
        if (!r.ok) return null;
        const data = await r.json();
        return {
          id: String(data.user_id),
          name: data.username,
          role: data.role,                // ADMIN | PARTNER
          partnerId: data.partner_id ?? null,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + data.expires_in * 1000,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) Object.assign(token, user);
      // Refresh logic if expired
      if (Date.now() > (token.expiresAt as number)) {
        token = await refreshAccessToken(token);
      }
      return token;
    },
    async session({ session, token }) {
      session.user.role = token.role;
      session.user.partnerId = token.partnerId;
      (session as any).accessToken = token.accessToken;
      return session;
    },
  },
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  trustHost: true,
});
```

`src/app/api/auth/[...nextauth]/route.ts`:
```ts
export { GET, POST } from "@/lib/auth";
```

### 3.2 Refresh logic

```ts
async function refreshAccessToken(token: any) {
  const r = await fetch(`${process.env.API_BASE_INTERNAL}/api/admin/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: token.refreshToken }),
  });
  if (!r.ok) return { ...token, error: "refresh_failed" };
  const data = await r.json();
  return {
    ...token,
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}
```

Khi `session.error === "refresh_failed"` → client redirect /login.

### 3.3 API_BASE handling

- `API_BASE_INTERNAL` (server-side, container-to-container): vd `http://smpp-server:8080`. Dùng trong `auth.ts` route handler chạy trên Node.
- `NEXT_PUBLIC_API_BASE` (browser): `/api` → đi qua Nginx proxy. Dùng trong `lib/api.ts` cho client component fetch.

`.env.example`:
```
API_BASE_INTERNAL=http://localhost:8080
NEXT_PUBLIC_API_BASE=http://localhost:8080
NEXTAUTH_SECRET=<32+ bytes>
NEXTAUTH_URL=http://localhost:3000
```

---

## 4. Middleware role guard

`src/middleware.ts`:

```ts
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const path = nextUrl.pathname;

  // Public paths
  if (path === "/login" || path.startsWith("/api/auth")) return;

  // Not logged in → /login
  if (!session) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  const role = session.user.role;

  // Role-based redirect
  if (path.startsWith("/admin") && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/portal/overview", nextUrl));
  }
  if (path.startsWith("/portal") && role !== "PARTNER") {
    return NextResponse.redirect(new URL("/admin/dashboard", nextUrl));
  }

  // Root /: redirect theo role
  if (path === "/") {
    return NextResponse.redirect(new URL(
      role === "ADMIN" ? "/admin/dashboard" : "/portal/overview",
      nextUrl
    ));
  }
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

---

## 5. Data fetching pattern

### 5.1 Server Component fetch (mặc định)

Dùng cho list/detail page render lần đầu. Pass token từ `auth()`:

```tsx
// src/app/(admin)/admin/partners/page.tsx
import { auth } from "@/lib/auth";
import { apiServer } from "@/lib/api";
import { PartnersTable } from "./PartnersTable";

export default async function PartnersPage({ searchParams }: { searchParams: { page?: string } }) {
  const session = await auth();
  const data = await apiServer(session, "/api/admin/partners", {
    query: { page: searchParams.page ?? "0", size: "20" },
  });
  return <PartnersTable initial={data} />;
}
```

### 5.2 Client Component với TanStack Query

Dùng cho refetch, mutation, realtime feel:

```tsx
"use client";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { apiClient } from "@/lib/api";

export function PartnersTable({ initial }: { initial: any }) {
  const { data: session } = useSession();
  const { data } = useQuery({
    queryKey: ["partners"],
    queryFn: () => apiClient(session, "/api/admin/partners"),
    initialData: initial,
    staleTime: 30_000,
  });
  // render table
}
```

### 5.3 `lib/api.ts` wrapper

```ts
type ApiOpts = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: any;
  query?: Record<string, string>;
};

export async function apiServer(session: any, path: string, opts: ApiOpts = {}) {
  const url = new URL(path, process.env.API_BASE_INTERNAL);
  if (opts.query) Object.entries(opts.query).forEach(([k,v]) => url.searchParams.set(k, v));
  const r = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  if (!r.ok) throw await toApiError(r);
  return r.json();
}

export async function apiClient(session: any, path: string, opts: ApiOpts = {}) {
  // Same nhưng dùng NEXT_PUBLIC_API_BASE
  ...
}

async function toApiError(r: Response) {
  const body = await r.json().catch(() => ({}));
  const e = new Error(body.detail || r.statusText) as any;
  e.status = r.status;
  e.problem = body;
  return e;
}
```

---

## 6. Form pattern

`src/components/forms/CreatePartnerForm.tsx`:

```tsx
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { apiClient } from "@/lib/api";
import { CreatePartnerSchema, type CreatePartner } from "@/lib/schemas";

export function CreatePartnerForm({ onClose }: { onClose: () => void }) {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const form = useForm<CreatePartner>({
    resolver: zodResolver(CreatePartnerSchema),
    defaultValues: { code: "", name: "" },
  });
  const m = useMutation({
    mutationFn: (data: CreatePartner) => apiClient(session, "/api/admin/partners", {
      method: "POST", body: data,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["partners"] }); onClose(); },
  });
  return <form onSubmit={form.handleSubmit((d) => m.mutate(d))}> ... </form>;
}
```

`src/lib/schemas.ts`:

```ts
import { z } from "zod";

export const CreatePartnerSchema = z.object({
  code: z.string().min(2).max(64).regex(/^[A-Z0-9_]+$/),
  name: z.string().min(1).max(255),
  dlr_webhook_url: z.string().url().optional(),
});
export type CreatePartner = z.infer<typeof CreatePartnerSchema>;

// ... tương tự cho Channel, Route, ApiKey, ...
```

Schema chia sẻ giữa BE và FE qua **manual sync** (BE có DTO Java, FE có Zod). KHÔNG dùng tRPC/codegen vì stack hỗn hợp Java+TS, giữ nguyên simplicity.

---

## 7. Theme

Tailwind v4 + CSS variables:

```css
/* globals.css */
@import "tailwindcss";

@theme {
  --color-background: hsl(0 0% 100%);
  --color-foreground: hsl(240 10% 3.9%);
  --color-primary: hsl(240 5.9% 10%);
  /* ... */
}

.dark {
  --color-background: hsl(240 10% 3.9%);
  --color-foreground: hsl(0 0% 98%);
  /* ... */
}
```

Dark mode toggle trong topbar, persist trong cookie (Next.js read được từ Server Component).

---

## 8. i18n

Phase 1: chỉ tiếng Việt. Tất cả label hardcode `vi`. Date format `dd/MM/yyyy HH:mm` (locale `vi`).

Phase tương lai: setup `next-intl` nếu cần multi-language.

---

## 9. Build & Docker

`Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1.6

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -s /bin/sh -D nextjs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
```

`next.config.ts`:
```ts
export default {
  output: "standalone",
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
};
```

---

## 10. Local dev

```bash
cd smpp/frontend
pnpm install
cp .env.example .env.local
# Edit .env.local nếu cần
pnpm dev   # http://localhost:3000
```

Yêu cầu BE chạy ở `http://localhost:8080`. CORS BE phải allow `http://localhost:3000` trong dev profile.

---

## 11. Convention

- File component PascalCase (`PartnerCard.tsx`).
- Hook camelCase prefix `use` (`usePartners.ts`).
- Page component default export, tên file `page.tsx` theo Next.js.
- Server Component (default) KHÔNG có "use client" directive.
- Client Component bắt buộc "use client" ở dòng đầu.
- KHÔNG fetch data trong Client Component lần đầu (dùng Server Component pass props). Client Component chỉ refetch/mutate.

---

## 12. Bundle size monitoring (gợi ý)

`pnpm next build` xuất report. Mục tiêu phase 1:
- Initial bundle (dashboard) < 200 KB gzipped.
- Largest route bundle < 300 KB.

Nếu vượt → split route bằng `next/dynamic`.
