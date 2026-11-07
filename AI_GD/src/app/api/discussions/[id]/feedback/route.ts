import { prisma } from "@/lib/db";
import { fail, guardOrigin, json, readBody } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { feedbackSchema } from "@/lib/validators";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser("HOST");
  if (!user) return error;
  const { id } = await context.params;
  const parsed = feedbackSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Provide a score from 0 to 100 and a short reason.");
  const evaluation = await prisma.evaluation.findUnique({ where: { id: parsed.data.evaluationId }, include: { discussion: true } });
  if (!evaluation || evaluation.discussionId !== id || evaluation.discussion.hostId !== user.id) return fail("Report not found.", 404);
  await prisma.evaluation.update({
    where: { id: evaluation.id },
    data: { adjustedScore: parsed.data.score, adjustmentReason: parsed.data.reason, adjustedById: user.id, adjustedAt: new Date() },
  });
  return json({ ok: true });
}
