import { prisma } from "@/lib/db";
import { fail, guardOrigin, json, readBody } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { feedbackSchema } from "@/lib/validators";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser();
  if (!user) return error;
  const { id } = await context.params;
  const participant = await prisma.discussionParticipant.findUnique({
    where: { discussionId_userId: { discussionId: id, userId: user.id } },
    include: { discussion: true, evaluation: { include: { parameters: true, notes: true } } },
  });
  if (!participant?.evaluation) return fail("Your feedback report is not available.", 404);
  const evaluation = participant.evaluation;
  const lines = [
    `Quorum feedback for ${participant.discussion.title}`,
    `Topic: ${participant.discussion.topic}`,
    `Evaluation source: ${evaluation.source}${evaluation.model ? ` (${evaluation.model})` : ""}`,
    `Overall score: ${evaluation.adjustedScore ?? evaluation.overallScore ?? "Incomplete"}`,
    "",
    "Pillar scores:",
    ...evaluation.parameters.map((item) => `${item.label}: ${item.score ?? "Not scored"} (${Math.round(item.weight * 100)}%)`),
    "",
    ...evaluation.notes.map((note) => `${note.kind}: ${note.body}`),
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="quorum-feedback-${id}.txt"`,
      "Cache-Control": "private, no-store",
    },
  });
}

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
