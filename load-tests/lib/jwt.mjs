/**
 * Minimal HS256 JWT signer, byte-compatible with the app's `jose` SignJWT usage
 * (see src/lib/auth.ts). Bots use this to authenticate hundreds of sockets quickly
 * without going through the login endpoint (which is itself rate-limited).
 */
import { createHmac } from "node:crypto";

const b64 = (input) => Buffer.from(input).toString("base64url");

export function signSession(user, secret) {
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(JSON.stringify({
    sub: user.id,
    role: user.role,
    email: user.email,
    name: user.name,
    iat: now,
    exp: now + 7 * 24 * 60 * 60,
  }));
  const data = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${signature}`;
}

export function cookieFor(user, secret) {
  return `quorum_token=${signSession(user, secret)}`;
}
