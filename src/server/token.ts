import { jwtVerify } from "jose";

export type TokenUser = { id: string; role: string; email: string; name: string };

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) return null;
  return new TextEncoder().encode(value);
}

export async function verifyToken(token: string): Promise<TokenUser | null> {
  const key = secret();
  if (!key) return null;
  try {
    const { payload } = await jwtVerify(token, key);
    if (!payload.sub || (payload.role !== "HOST" && payload.role !== "PARTICIPANT")) return null;
    return {
      id: String(payload.sub),
      role: String(payload.role),
      email: String(payload.email || ""),
      name: String(payload.name || ""),
    };
  } catch {
    return null;
  }
}

export function tokenFromCookie(header: string | undefined) {
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    if (part.startsWith("quorum_token=")) return decodeURIComponent(part.slice("quorum_token=".length));
  }
  return null;
}
