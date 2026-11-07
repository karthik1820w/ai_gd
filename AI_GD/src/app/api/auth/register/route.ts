import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { cookieOptions, signSession } from "@/lib/auth";
import { clientKey, fail, guardOrigin, json, rateLimit, readBody } from "@/lib/http";
import { registerSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  if (!rateLimit(`register:${clientKey(request)}`, 8, 600_000)) return fail("Too many attempts. Wait a few minutes.", 429);
  const parsed = registerSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Use a real email, a name, and a password of at least 8 characters.");
  const email = parsed.data.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) return fail("An account with that email already exists.", 409);
  const user = await prisma.user.create({
    data: { email, name: parsed.data.name, role: parsed.data.role, passwordHash: await bcrypt.hash(parsed.data.password, 12) },
  });
  const token = await signSession(user);
  const jar = await cookies();
  jar.set("quorum_token", token, cookieOptions());
  return json({ id: user.id, name: user.name, role: user.role, next: user.role === "HOST" ? "/host" : "/participant" });
}
