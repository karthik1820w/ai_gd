import { cookies } from "next/headers";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { cookieOptions, signSession } from "@/lib/auth";
import { clientKey, fail, guardOrigin, json, rateLimit, readBody } from "@/lib/http";
import { HOST_EMAIL } from "@/lib/roles";
import { registerSchema } from "@/lib/validators";

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  if (!rateLimit(`register:${clientKey(request)}`, 8, 600_000)) return fail("Too many attempts. Wait a few minutes.", 429);
  const parsed = registerSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Use a real email, a name, and a password of at least 8 characters.");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
    console.error("Account registration is unavailable because JWT_SECRET is missing or too short.");
    return fail("Account creation is temporarily unavailable. Please contact the administrator.", 503);
  }
  const email = parsed.data.email.toLowerCase();
  if (email === HOST_EMAIL) return fail("This host account is provisioned by an administrator. Please sign in.", 403);
  const existingMessage = "This email is already registered.";
  try {
    if (await prisma.user.findUnique({ where: { email } })) return fail(existingMessage, 409);
    const user = await prisma.user.create({
      data: { email, name: parsed.data.name, role: "PARTICIPANT", passwordHash: await bcrypt.hash(parsed.data.password, 12) },
    });
    const token = await signSession(user);
    const jar = await cookies();
    jar.set("quorum_token", token, cookieOptions(request));
    return json({ id: user.id, name: user.name, role: user.role, next: "/participant" });
  } catch (error) {
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "";
    if (code === "P2002") return fail(existingMessage, 409);
    if (code === "P2021" || code === "P2022") {
      console.error("Registration failed because the PostgreSQL schema has not been applied.", error);
      return fail("The account database needs setup. Run `npm run db:push:vercel` with the Vercel database URLs.", 503);
    }
    if (error instanceof Prisma.PrismaClientInitializationError || ["P1000", "P1001", "P1002", "P1017"].includes(code)) {
      console.error("Registration failed because the account database is unavailable.", error);
      return fail("The account database is unavailable. Check the Vercel DATABASE_URL and Neon connection settings.", 503);
    }
    console.error("Account registration failed.", error);
    return fail("Could not create the account right now. Please try again.", 500);
  }
}
