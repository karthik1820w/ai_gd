import { prisma } from "@/lib/db";
import { clientKey, fail, guardOrigin, json, rateLimit, readBody } from "@/lib/http";
import { forgotSchema, resetSchema } from "@/lib/validators";
import { appOrigin, hashToken, newToken } from "@/server/ids";
import { sendMail } from "@/server/mail";
import bcrypt from "bcryptjs";

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  if (new URL(request.url).pathname.endsWith("/reset")) return reset(request);
  return forgot(request);
}

async function forgot(request: Request) {
  if (!rateLimit(`forgot:${clientKey(request)}`, 6, 600_000)) return fail("Too many attempts. Wait a few minutes.", 429);
  const parsed = forgotSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Enter the email on your account.");
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  let devResetUrl: string | undefined;
  if (user) {
    const token = newToken();
    await prisma.passwordReset.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60_000) },
    });
    const url = `${appOrigin(request)}/reset-password?token=${token}`;
    await sendMail(user.email, "Reset your Quorum password", `Open this link within 30 minutes:\n${url}\n\nIf you did not ask for this, ignore the email.`);
    if (process.env.NODE_ENV !== "production") devResetUrl = url;
  }
  return json({ ok: true, message: "If that email has an account, a reset link is on its way.", devResetUrl });
}

async function reset(request: Request) {
  const parsed = resetSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Choose a password of at least 8 characters.");
  const row = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(parsed.data.token) } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return fail("This reset link has expired. Request a new one.", 400);
  await prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await bcrypt.hash(parsed.data.password, 12) } });
  await prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return json({ ok: true });
}
