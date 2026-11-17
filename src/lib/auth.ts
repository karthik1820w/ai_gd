import { cache } from "react";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/db";
import { authorizedRole } from "@/lib/roles";
import { secureCookie } from "@/lib/securityConfig";

export const COOKIE = "quorum_token";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "HOST" | "PARTICIPANT";
  speechLang: string;
};

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value || value.length < 16) throw new Error("JWT_SECRET is missing or too short.");
  return new TextEncoder().encode(value);
}

export async function signSession(user: SessionUser) {
  return new SignJWT({ role: user.role, email: user.email, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}

export function cookieOptions(request?: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: secureCookie(request, process.env.COOKIE_SECURE, process.env.NODE_ENV === "production"),
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}

// The signed cookie already proves who the person is; the database lookup only confirms the account still exists
// and its role. Doing it on every page, layout and API call made every click wait on the database several times,
// so the answer is remembered briefly. `forgetSession` drops it when the account changes.
const SESSION_TTL_MS = 30_000;
type Known = { user: Omit<SessionUser, "role"> & { role: string }; at: number };
const known = new Map<string, Known>();

export function forgetSession(userId: string) {
  known.delete(userId);
}

async function lookupUser(id: string) {
  const hit = known.get(id);
  if (hit && Date.now() - hit.at < SESSION_TTL_MS) return hit.user;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, role: true, speechLang: true },
  });
  if (!user) { known.delete(id); return null; }
  if (known.size > 2000) known.clear();
  known.set(id, { user, at: Date.now() });
  return user;
}

async function readSessionUncached(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    const user = await lookupUser(String(payload.sub));
    if (!user) return null;
    const role = authorizedRole(user.email, user.role as SessionUser["role"]);
    if (role !== payload.role) return null;
    return { ...user, role };
  } catch {
    return null;
  }
}

/** Once per request, however many layouts, pages and helpers ask. */
export const readSession = cache(readSessionUncached);

export function safeNext(next: string | null | undefined, role: SessionUser["role"]) {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) return next;
  return role === "HOST" ? "/host" : "/participant";
}
