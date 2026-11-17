import { spawn } from "child_process";
import { existsSync } from "fs";
import { prisma } from "@/lib/db";
import { getSTTClient } from "@/server/transcriber";
import { SAMPLE_RATE, pcmToBuffer, planChunks, toSegments } from "@/server/sttChunks";
import { wordCount } from "@/server/scoring";

export type RecordingTranscription = {
  status: "ok" | "skipped" | "stt_unavailable";
  detail: string;
  participants: Array<{ participantId: string; name: string; segments: number; note?: string }>;
};

const ffmpegBinary = process.env.FFMPEG || "ffmpeg";
let activeJobs = 0;

/** Decode any browser recording (WebM/Opus) to 16 kHz mono int16 PCM with ffmpeg. */
function decodeToPcm(file: string): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegBinary, ["-v", "error", "-i", file, "-f", "s16le", "-ac", "1", "-ar", String(SAMPLE_RATE), "pipe:1"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const parts: Buffer[] = [];
    let stderr = "";
    proc.stdout.on("data", (data: Buffer) => parts.push(data));
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    proc.once("error", (error) => reject(new Error(`ffmpeg could not start: ${error.message}`)));
    proc.once("close", (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(0, 200)}`));
      const buffer = Buffer.concat(parts);
      const even = buffer.length - (buffer.length % 2);
      resolve(new Int16Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + even)));
    });
  });
}

/**
 * Fill transcript gaps from stored microphone recordings.
 *
 * Only people with consent for both transcription and recording, and who have
 * no live transcript (browser without speech recognition, or nothing captured),
 * are processed. Live lines are never replaced. Lines made here are stored with
 * source "recording"; `force` re-runs and replaces only those lines.
 */
export async function transcribeRecordings(discussionId: string, options: { force?: boolean } = {}): Promise<RecordingTranscription> {
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
    include: {
      transcript: true,
      recordings: true,
      participants: { include: { segments: { select: { source: true } } } },
    },
  });
  if (!discussion) return { status: "skipped", detail: "Discussion not found.", participants: [] };
  if (!discussion.transcriptionEnabled || discussion.transcriptsPurgedAt) return { status: "skipped", detail: "Transcription is off or the transcript was purged.", participants: [] };
  if (!discussion.transcript) return { status: "skipped", detail: "No transcript record exists.", participants: [] };

  const targets = discussion.participants.filter((person) => {
    if (person.removed || person.userId === discussion.hostId) return false;
    if (!person.transcriptionConsent || !person.recordingConsent) return false;
    const recording = discussion.recordings.find((item) => item.participantId === person.id);
    if (!recording || !existsSync(recording.path)) return false;
    const live = person.segments.filter((segment) => segment.source !== "recording").length;
    const fromRecording = person.segments.length - live;
    if (fromRecording > 0 && !options.force) return false;
    return live === 0 || !person.speechAvailable;
  });
  if (!targets.length) return { status: "skipped", detail: "Nobody needs a transcript generated from a recording.", participants: [] };

  const client = getSTTClient();
  if (!client) return { status: "stt_unavailable", detail: "The speech-to-text worker is not installed.", participants: [] };

  activeJobs++;
  const results: RecordingTranscription["participants"] = [];
  try {
    for (const person of targets) {
      const recording = discussion.recordings.find((item) => item.participantId === person.id)!;
      try {
        const pcm = await decodeToPcm(recording.path);
        const chunks = planChunks(pcm);
        const texts: string[] = [];
        for (const chunk of chunks) texts.push(await client.transcribe(pcmToBuffer(pcm, chunk)));
        const segments = toSegments(chunks, texts);
        if (chunks.length > 0 && segments.length === 0 && texts.every((text) => !text)) {
          results.push({ participantId: person.id, name: person.displayName, segments: 0, note: "Speech was detected but the STT worker returned no text. Check STT_MODEL_DIR." });
          continue;
        }
        const base = (person.joinedAt ?? discussion.startedAt ?? discussion.scheduledAt).getTime();
        await prisma.$transaction([
          prisma.transcriptSegment.deleteMany({ where: { participantId: person.id, source: "recording" } }),
          prisma.transcriptSegment.createMany({
            data: segments.map((segment) => ({
              transcriptId: discussion.transcript!.id,
              discussionId,
              participantId: person.id,
              text: segment.text,
              startedAt: new Date(base + segment.offsetMs),
              endedAt: new Date(base + segment.offsetMs + segment.durationMs),
              wordCount: wordCount(segment.text),
              relevance: "PENDING" as const,
              source: "recording",
            })),
          }),
        ]);
        if (segments.length) {
          await prisma.speakingStat.upsert({
            where: { participantId: person.id },
            create: { participantId: person.id, contributionCount: segments.length, speakingMs: segments.reduce((sum, item) => sum + item.durationMs, 0) },
            update: { contributionCount: segments.length },
          });
        }
        results.push({ participantId: person.id, name: person.displayName, segments: segments.length });
      } catch (error) {
        console.error("Could not transcribe a recording.", error);
        results.push({ participantId: person.id, name: person.displayName, segments: 0, note: error instanceof Error ? error.message : "Transcription failed." });
      }
    }
  } finally {
    activeJobs--;
    if (activeJobs === 0) client.close();
  }
  const total = results.reduce((sum, item) => sum + item.segments, 0);
  return { status: total > 0 ? "ok" : "stt_unavailable", detail: `${total} line${total === 1 ? "" : "s"} generated from recordings.`, participants: results };
}
