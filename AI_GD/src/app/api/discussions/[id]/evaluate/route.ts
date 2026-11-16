import { prisma } from "@/lib/db";
import { fail, guardOrigin, json } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { evaluateDiscussion, evaluationError } from "@/server/evaluate";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser("HOST");
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({ where: { id } });
  if (!discussion || discussion.hostId !== user.id) return fail("Discussion not found.", 404);
  if (discussion.status !== "COMPLETED") return fail("End the discussion before recalculating.", 409);
  try {
    await evaluateDiscussion(id);
    return json({ ok: true });
  } catch (error) {
    console.error("Recalculation failed.", error);
    return fail(evaluationError(id) || `Scoring stopped with an error: ${error instanceof Error ? error.message.slice(0, 200) : "unknown"}`, 500);
  }
}
