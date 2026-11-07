import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { fail, guardOrigin, json, readBody } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { passwordSchema, profileSchema } from "@/lib/validators";

export async function GET() {
  const { user, error } = await requireUser();
  if (!user) return error;
  return json(user);
}

export async function PATCH(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser();
  if (!user) return error;
  const parsed = profileSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Check your name and speech language.");
  const updated = await prisma.user.update({ where: { id: user.id }, data: parsed.data, select: { id: true, name: true, speechLang: true, role: true, email: true } });
  return json(updated);
}

export async function DELETE(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser();
  if (!user) return error;
  const body = (await readBody(request)) as { password?: string } | null;
  const stored = await prisma.user.findUnique({ where: { id: user.id } });
  if (!stored || !body?.password || !(await bcrypt.compare(body.password, stored.passwordHash))) return fail("Password does not match.", 403);
  await prisma.user.delete({ where: { id: user.id } });
  return json({ ok: true });
}

export async function PUT(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser();
  if (!user) return error;
  const parsed = passwordSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Enter your current password and a new one of at least 8 characters.");
  const stored = await prisma.user.findUnique({ where: { id: user.id } });
  if (!stored || !(await bcrypt.compare(parsed.data.currentPassword, stored.passwordHash))) return fail("Current password is incorrect.", 403);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await bcrypt.hash(parsed.data.nextPassword, 12) } });
  return json({ ok: true });
}
