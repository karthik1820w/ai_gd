import { prisma } from "@/lib/db";
import { fail, guardOrigin, json, rateLimit } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { wavInfo } from "@/lib/audioChunks";
import { addSegmentResult } from "@/server/segments";
import { serverSttAvailable, transcribeAudio } from "@/server/transcribeAudio";
import { logTranscriptDiagnostic } from "@/server/transcriptDiagnostics";

/**
 * Fallback transcription. When a participant's browser cannot transcribe speech itself, their browser
 * sends short spoken clips here (WAV, 16-bit mono). The clip is turned into text by Gemini and the text
 * is saved exactly like a live line. The audio is not stored.
 */
const MAX_BYTES = 1_000_000;
const CALLS_PER_ROOM = Math.max(1, Number.parseInt(process.env.AI_MAX_TRANSCRIBE_CALLS_PER_ROOM || "1500", 10) || 1500);
const roomCalls = new Map<string, number>();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser();
  if (!user) return error;
  const { id } = await context.params;
  if (!rateLimit(`audio:${user.id}`, 40, 60_000)) return fail("Too many clips. Speak a little slower.", 429);
  if (!serverSttAvailable()) return fail("Audio transcription needs a Gemini key or the offline Whisper model, and neither is set up on this server.", 503);

  const [discussion, participant] = await Promise.all([
    prisma.discussion.findUnique({ where: { id }, select: { id: true, hostId: true, status: true, transcriptionEnabled: true, transcriptsPurgedAt: true } }),
    prisma.discussionParticipant.findUnique({ where: { discussionId_userId: { discussionId: id, userId: user.id } } }),
  ]);
  if (!discussion || !participant) return fail("You are not part of this discussion.", 403);
  if (participant.removed) return fail("You were removed from this discussion.", 403);
  if (user.id === discussion.hostId) return fail("The host is not transcribed.", 409);
  if (discussion.status === "COMPLETED" || discussion.status === "CANCELLED") return fail("This discussion has ended.", 409);
  if (!discussion.transcriptionEnabled || discussion.transcriptsPurgedAt) return fail("Transcription is switched off for this discussion.", 409);
  if (!participant.transcriptionConsent) return fail("Your transcription consent was not recorded. Leave, rejoin, and tick the consent box.", 403);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return fail("That clip is too large.", 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_BYTES) return fail("That clip is too large.", 413);
  const info = wavInfo(bytes);
  if (!info.ok) return fail(info.reason, 400);

  const used = roomCalls.get(id) ?? 0;
  if (used >= CALLS_PER_ROOM) return fail("The audio transcription limit for this discussion has been reached.", 429);
  roomCalls.set(id, used + 1);

  let text: string | null;
  try {
    text = await transcribeAudio(Buffer.from(bytes));
  } catch (caught) {
    console.error("Audio transcription failed.", caught);
    return fail("The transcription service did not answer. Your words were not saved; try again or type your points.", 502);
  }
  if (!text) return json({ ok: true, empty: true });

  const now = Date.now();
  logTranscriptDiagnostic(id, { stage: "stt", eventType: "final", segmentId: `audio-${now}`, speakerId: user.id, startedAt: new Date(now - info.seconds * 1000).toISOString(), endedAt: new Date(now).toISOString(), text, confidence: null, silence: false, source: "recording" });
  const result = await addSegmentResult({
    discussionId: id,
    userId: user.id,
    text,
    startedAt: new Date(now - info.seconds * 1000).toISOString(),
    endedAt: new Date(now).toISOString(),
    source: "recording",
  });
  if (!result.ok) return json({ ok: false, reason: result.reason, message: result.message, benign: result.benign }, 200);
  return json({ ok: true, text });
}
