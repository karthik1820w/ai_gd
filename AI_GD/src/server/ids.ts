import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";

export function newMeetingId() {
  return randomBytes(5).toString("hex");
}

export function newAccessCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken() {
  return randomBytes(32).toString("hex");
}

export function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function appOrigin(request?: Request) {
  const configured = process.env.APP_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase())) return configured.replace(/\/+$/, "");
  }
  if (!request) return configured?.replace(/\/+$/, "") || "http://localhost:3000";
  const requestUrl = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || requestUrl.host || "localhost:3000";
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || requestUrl.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function meetingUrl(origin: string, meetingId: string, code: string) {
  return `${origin}/meeting/${meetingId}?code=${code}`;
}
