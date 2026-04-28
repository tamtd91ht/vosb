import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// AUTH BYPASS — remove when BE is ready for E2E login test
export default function middleware(_req: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|_next).*)"],
};
