import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const publicPaths = new Set(["/", "/login", "/register", "/forgot-password", "/reset-password", "/api/health", "/api/auth/login", "/api/auth/register", "/api/auth/forgot", "/api/auth/reset"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || pathname === "/icon.svg") return NextResponse.next();
  const token = request.cookies.get("quorum_token")?.value;
  const secret = process.env.JWT_SECRET;
  let role: string | null = null;
  if (token && secret) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
      role = typeof payload.role === "string" ? payload.role : null;
    } catch {
      role = null;
    }
  }
  if (publicPaths.has(pathname)) return NextResponse.next();
  if (!role) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/host") && role !== "HOST") {
    return NextResponse.redirect(new URL("/participant", request.url));
  }
  if (pathname.startsWith("/participant") && role !== "PARTICIPANT") {
    return NextResponse.redirect(new URL("/host", request.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
