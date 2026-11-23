import fs from "fs";
import path from "path";

export type TranscriptDiagnostic = {
  stage: "stt" | "captured" | "persisted" | "displayed";
  eventType: "partial" | "final";
  segmentId: string | null;
  captureId?: string | null;
  speakerId: string;
  startedAt: string | null;
  endedAt: string | null;
  text: string;
  confidence: number | null;
  silence: boolean | null;
  clientAt?: number;
  source?: "live" | "recording" | null;
  duplicate?: boolean;
};

export function transcriptDiagnosticsEnabled() {
  return process.env.TRANSCRIPT_DIAGNOSTICS === "1";
}

export function logTranscriptDiagnostic(discussionId: string, record: TranscriptDiagnostic) {
  if (!transcriptDiagnosticsEnabled() || !/^[a-zA-Z0-9_-]+$/.test(discussionId)) return;
  const dir = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, "transcript-diagnostics")
    : path.join(process.cwd(), "data", "transcript-diagnostics");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${discussionId}.jsonl`);
    fs.appendFileSync(file, `${JSON.stringify({ ...record, arrivalAt: Date.now() })}\n`, { encoding: "utf8", flag: "a" });
  } catch (error) {
    console.error("Transcript diagnostic write failed.", error);
  }
}
