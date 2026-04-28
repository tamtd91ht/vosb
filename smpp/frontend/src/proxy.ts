import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Next 16 Proxy (formerly Middleware) wrapped by NextAuth's `auth()` helper.
 *
 * - Unauthenticated visit to /admin/* or /portal/*  → redirect /login.
 * - Authenticated visit to /login                   → bounce to role landing.
 * - Cross-role access (PARTNER on /admin, etc.)     → redirect to own area.
 *
 * Note: this is an optimistic check based on the JWT cookie only — final
 * authorization is enforced again in the server layouts via `await auth()`.
 */
export default auth((req) => {
  const { nextUrl } = req;
  const session = req.auth;
  const path = nextUrl.pathname;

  const isAdminRoute = path.startsWith("/admin");
  const isPortalRoute = path.startsWith("/portal");
  const isLoginRoute = path === "/login";
  const role = session?.user?.role;

  if (!session?.user && (isAdminRoute || isPortalRoute)) {
    const url = new URL("/login", nextUrl);
    if (path !== "/") url.searchParams.set("callbackUrl", path);
    return NextResponse.redirect(url);
  }

  if (session?.user && isLoginRoute) {
    const dest = role === "ADMIN" ? "/admin/dashboard" : "/portal/overview";
    return NextResponse.redirect(new URL(dest, nextUrl));
  }

  if (session?.user && isAdminRoute && role !== "ADMIN") {
    return NextResponse.redirect(new URL("/portal/overview", nextUrl));
  }
  if (session?.user && isPortalRoute && role !== "PARTNER") {
    return NextResponse.redirect(new URL("/admin/dashboard", nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth).*)"],
};
