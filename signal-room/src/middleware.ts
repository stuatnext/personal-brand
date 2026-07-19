import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, expectedSessionToken, passcodeConfigured } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  if (!passcodeConfigured()) return NextResponse.next();
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/login") ||
    pathname.startsWith("/api/health") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  const expected = await expectedSessionToken();
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (expected && cookie === expected) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
