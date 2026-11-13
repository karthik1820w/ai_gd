import { prisma } from "@/lib/db";
import { fail, guardOrigin, json } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { endDiscussion } from "@/server/evaluate";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser("HOST");
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({ where: { id } });
  if (!discussion || discussion.hostId !== user.id) return fail("Discussion not found.", 404);
  // Close the room now; scoring (which may wait on AI analysis) finishes in the background.
  const result = await endDiscussion(id, { background: true });
  if (!result.ok) return fail(result.error, 409);
  return json({ ok: true, preparing: true });
}
