import { prisma } from "@/lib/db";
import { fail, guardOrigin, json } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { TRANSCRIPT_FORMATS, filterBySpeaker, renderTranscript, type TranscriptFormat } from "@/server/transcript";
import { generateTranscript } from "@/server/transcriptStore";
import { transcribeRecordings } from "@/server/transcribeRecordings";

/**
 * GET  ?format=txt|md|json|srt[&speaker=<participantId>]  Host: everyone (or one person). Participant: their own lines only. Scores are never included.
 * POST                           Host only: fill gaps from stored recordings, then recalculate scores separately.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await requireUser();
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({ where: { id }, include: { participants: { select: { id: true, userId: true, removed: true } } } });
  if (!discussion) return fail("Discussion not found.", 404);
  const isHost = discussion.hostId === user.id;
  const mine = discussion.participants.find((participant) => participant.userId === user.id && !participant.removed);
  if (!isHost && !mine) return fail("You cannot view this transcript.", 403);
  if (discussion.transcriptsPurgedAt) return fail("The transcript was deleted under this session's retention setting.", 410);

  const url = new URL(request.url);
  const format = (url.searchParams.get("format") || "txt").toLowerCase() as TranscriptFormat;
  if (!TRANSCRIPT_FORMATS.includes(format)) return fail(`Format must be one of: ${TRANSCRIPT_FORMATS.join(", ")}.`);
  const full = await generateTranscript(id);
  if (!full) return fail("Discussion not found.", 404);
  // The host can read everyone, or one person. A participant always gets only their own lines.
  const speaker = isHost ? url.searchParams.get("speaker") : mine!.id;
  const doc = speaker ? filterBySpeaker(full, speaker) : full;
  const rendered = renderTranscript(doc, format);
  const safe = discussion.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 60) || "discussion";
  return new Response(rendered.body, {
    headers: {
      "Content-Type": rendered.contentType,
      "Content-Disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${safe}-transcript.${rendered.extension}"`,
    },
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser("HOST");
  if (!user) return error;
  const { id } = await context.params;
  const discussion = await prisma.discussion.findUnique({ where: { id } });
  if (!discussion || discussion.hostId !== user.id) return fail("Discussion not found.", 404);
  if (discussion.status === "LIVE") return fail("End the discussion before generating from recordings.", 409);
  const result = await transcribeRecordings(id, { force: true });
  return json(result);
}
