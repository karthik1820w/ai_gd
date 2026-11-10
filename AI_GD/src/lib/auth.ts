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

export async function readSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    const user = await prisma.user.findUnique({
      where: { id: String(payload.sub) },
      select: { id: true, email: true, name: true, role: true, speechLang: true },
    });
    if (!user) return null;
    const role = authorizedRole(user.email, user.role);
    if (role !== payload.role) return null;
    return { ...user, role };
  } catch {
    return null;
  }
}

export function safeNext(next: string | null | undefined, role: SessionUser["role"]) {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\")) return next;
  return role === "HOST" ? "/host" : "/participant";
}
