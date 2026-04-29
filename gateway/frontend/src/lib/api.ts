import { auth } from "@/lib/auth";

type ApiOpts = {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  token?: string;
};

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

function buildUrl(
  base: string,
  path: string,
  query?: ApiOpts["query"]
): string {
  const url = new URL(path, base);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    });
  }
  return url.toString();
}

async function handleResponse(r: Response) {
  if (!r.ok) {
    let detail = r.statusText;
    try {
      const body = await r.json();
      detail = body.detail || body.title || r.statusText;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(r.status, detail);
  }
  if (r.status === 204) return null;
  return r.json();
}

// Server-side fetch (runs in Server Components, API Route Handlers)
export async function apiServer(path: string, opts: ApiOpts = {}) {
  const session = await auth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const token = opts.token ?? (session as any)?.accessToken;
  const url = buildUrl(
    process.env.API_BASE_INTERNAL ?? "http://localhost:8080",
    path,
    opts.query
  );
  const r = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  return handleResponse(r);
}

// Client-side fetch (runs in Client Components, uses NEXT_PUBLIC_API_BASE)
export async function apiClient(
  token: string | undefined,
  path: string,
  opts: ApiOpts = {}
) {
  const base =
    process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8080";
  const url = buildUrl(base, path, opts.query);
  const r = await fetch(url, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return handleResponse(r);
}
