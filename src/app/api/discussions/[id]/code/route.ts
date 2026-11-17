import { prisma } from "@/lib/db";
import { fail, guardOrigin, json } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { newAccessCode } from "@/server/ids";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser("HOST");
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({ where: { id } });
  if (!discussion || discussion.hostId !== user.id) return fail("Discussion not found.", 404);
  await prisma.accessCode.updateMany({ where: { discussionId: id, active: true }, data: { active: false } });
  const code = await prisma.accessCode.create({ data: { discussionId: id, code: newAccessCode(), active: true } });
  return json({ code: code.code });
}
