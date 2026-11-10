import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { cookieOptions, safeNext, signSession } from "@/lib/auth";
import { clientKey, fail, guardOrigin, json, loginRateLimitKeys, rateLimit, readBody } from "@/lib/http";
import { authorizedRole } from "@/lib/roles";
import { loginSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  if (!rateLimit(`login:ip:${clientKey(request)}`, 30, 600_000)) return fail("Too many attempts. Wait a few minutes.", 429);
  const parsed = loginSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Enter your email and password.");
  const email = parsed.data.email.trim().toLowerCase();
  const limitKeys = loginRateLimitKeys(request, email);
  if (!rateLimit(limitKeys.email, 12, 600_000)) return fail("Too many attempts. Wait a few minutes.", 429);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return fail("Email or password is incorrect.", 401);
  const role = authorizedRole(user.email, user.role);
  const sessionUser = { ...user, role };
  const token = await signSession(sessionUser);
  const jar = await cookies();
  jar.set("quorum_token", token, cookieOptions(request));
  const next = safeNext(new URL(request.url).searchParams.get("next"), role);
  return json({ id: user.id, name: user.name, role, next });
}
