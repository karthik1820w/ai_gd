import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { cookieOptions, safeNext, signSession } from "@/lib/auth";
import { clientKey, fail, guardOrigin, json, loginRateLimitKeys, rateLimit, readBody } from "@/lib/http";
import { hostPasswordMatches, isHostEmail, readHostConfig } from "@/lib/hostAccount";
import { authorizedRole } from "@/lib/roles";
import { loginSchema } from "@/lib/validators";
import { provisionHost } from "@/server/hostProvision";

const WRONG = "Email or password is incorrect.";

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    console.error("Sign-in is unavailable: JWT_SECRET is missing or shorter than 16 characters.");
    return fail("Sign-in is not configured on the server (JWT_SECRET).", 503);
  }
  if (!rateLimit(`login:ip:${clientKey(request)}`, 30, 600_000)) return fail("Too many attempts. Wait a few minutes.", 429);
  const parsed = loginSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Enter your email and password.");
  const email = parsed.data.email.trim().toLowerCase();
  const limitKeys = loginRateLimitKeys(request, email);
  if (!rateLimit(limitKeys.email, 12, 600_000)) return fail("Too many attempts. Wait a few minutes.", 429);

  try {
    let user;
    if (isHostEmail(email)) {
      // Host: the password in the environment is the only credential.
      const config = readHostConfig();
      if (!config.ok) {
        console.error(`Host sign-in is unavailable: ${config.error}`);
        return fail("Host sign-in is not configured on the server (HOST_EMAIL / HOST_PASSWORD).", 503);
      }
      if (!hostPasswordMatches(parsed.data.password, config.password)) return fail(WRONG, 401);
      user = await provisionHost(config);
    } else {
      user = await prisma.user.findUnique({ where: { email } });
      if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return fail(WRONG, 401);
    }
    const role = authorizedRole(user.email, user.role);
    const token = await signSession({ ...user, role });
    const jar = await cookies();
    jar.set("quorum_token", token, cookieOptions(request));
    const next = safeNext(new URL(request.url).searchParams.get("next"), role);
    return json({ id: user.id, name: user.name, role, next });
  } catch (error) {
    // Usually an unreachable database or a schema that has not been pushed yet.
    console.error("Sign-in failed because of a server error.", error);
    return fail("Sign-in is temporarily unavailable. The server could not reach its database.", 503);
  }
}
