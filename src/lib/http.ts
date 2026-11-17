import { NextResponse } from "next/server";
import { loginRateLimitKeys } from "@/server/clientAddress";
import { rateLimit } from "@/server/httpRateLimit";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(error: string, status = 400) {
  return json({ error }, status);
}

export async function readBody(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function clientKey(request: Request) {
  return request.headers.get("x-real-ip")?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

export { loginRateLimitKeys };

export { rateLimit };

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function guardOrigin(request: Request) {
  if (!sameOrigin(request)) return fail("This request was blocked.", 403);
  return null;
}
