import { prisma } from "@/lib/db";
import { fail, json } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { filterBySpeaker } from "@/server/transcript";
import { generateTranscript } from "@/server/transcriptStore";
import { formulaText, groupSummaryView, personView } from "@/server/resultsView";

/**
 * Results for the finished-discussion screen.
 * Host: every person's score and transcript. Participant: only their own score and
 * transcript, plus a group summary that contains nobody else's words or ranking.
 * `ready` is false until scoring has finished, so the screen can wait and retry.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser();
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({
    where: { id },
    include: {
      participants: { include: { evaluation: { include: { parameters: true, notes: true } } } },
      summary: { include: { points: true } },
    },
  });
  if (!discussion) return fail("Discussion not found.", 404);
  const isHost = discussion.hostId === user.id;
  const mine = discussion.participants.find((person) => person.userId === user.id && !person.removed);
  if (!isHost && !mine) return fail("You cannot view these results.", 403);
  if (discussion.status !== "COMPLETED") return json({ ready: false, status: discussion.status });

  const scored = discussion.participants.filter((person) => !person.removed && person.userId !== discussion.hostId);
  const visible = isHost ? scored : scored.filter((person) => person.id === mine!.id);
  const withEvaluation = visible.filter((person) => person.evaluation);
  // Ready once every person this viewer may see has been scored.
  const ready = withEvaluation.length === visible.length && Boolean(discussion.summary) && visible.length > 0;
  if (!ready) return json({ ready: false, status: discussion.status });

  const people = withEvaluation.map((person) => {
    const evaluation = person.evaluation!;
    return personView({
      participantId: person.id,
      name: person.displayName,
      overallScore: evaluation.overallScore,
      adjustedScore: evaluation.adjustedScore,
      category: evaluation.category,
      incomplete: evaluation.incomplete,
      incompleteReason: evaluation.incompleteReason,
      speakingMs: evaluation.speakingMs,
      contributionCount: evaluation.contributionCount,
      parameters: evaluation.parameters.map((parameter) => ({ key: parameter.key, label: parameter.label, weight: parameter.weight, score: parameter.score })),
      notes: evaluation.notes,
    });
  });

  const full = discussion.transcriptsPurgedAt ? null : await generateTranscript(id);
  const doc = full && !isHost ? filterBySpeaker(full, mine!.id) : full;
  const first = withEvaluation[0]?.evaluation;
  return json({
    ready: true,
    status: discussion.status,
    role: isHost ? "host" : "participant",
    evaluatedBy: first?.source === "gemini" ? `Gemini${first.model ? ` (${first.model})` : ""}` : "the built-in scoring",
    formula: formulaText(people[0]?.parameters ?? []),
    summary: discussion.summary ? groupSummaryView(discussion.summary.source, discussion.summary.points, isHost) : null,
    people,
    transcript: doc ? { turns: doc.turns.map((turn) => ({ index: turn.index, speakerId: turn.speakerId, speaker: turn.speaker, offsetSec: turn.offsetSec, text: turn.text, source: turn.source })) } : { turns: [] },
  });
}
