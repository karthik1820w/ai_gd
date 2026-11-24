import fs from "fs";
import path from "path";
import { aiEnabled, complete, parseJson } from "@/server/ai";
import { TRANSCRIBE_SCHEMA, TRANSCRIBE_SYSTEM } from "@/server/aiPrompts";
import { getSTTClient } from "@/server/transcriber";

/** True when the offline Whisper worker and a model are installed on this server (no AI key needed). */
export function whisperAvailable() {
  const worker = path.join(process.cwd(), "scripts", "stt", "worker.py");
  const model = process.env.STT_MODEL_DIR || path.join(process.cwd(), "models", "sherpa-onnx-whisper-tiny.en");
  return fs.existsSync(worker) && fs.existsSync(model);
}

/** Whether this server can turn a spoken clip into text at all: Gemini, or the offline Whisper worker. */
export function serverSttAvailable() {
  return aiEnabled() || whisperAvailable();
}

/**
 * Turn a short WAV clip (16 kHz, 16-bit mono) into text. Gemini is used when configured, otherwise the
 * offline Whisper worker. Returns "" when there is no clear speech and null when neither is available.
 * Throws if the Gemini call fails, so the caller can tell the person.
 */
export async function transcribeAudio(wav: Buffer, vocabulary = ""): Promise<string | null> {
  if (aiEnabled()) {
    const raw = await complete(TRANSCRIBE_SYSTEM, `Transcribe this audio clip. Topic and vocabulary for spelling context only: ${vocabulary.slice(0, 1500)}. Preserve the words and meaning that were actually spoken.`, {
      audio: { mimeType: "audio/wav", base64: wav.toString("base64") },
      responseSchema: TRANSCRIBE_SCHEMA,
      retries: 1,
      timeoutMs: 25_000,
    });
    if (raw !== null) return String(parseJson(raw).text ?? "").replace(/\s+/g, " ").trim();
  }
  if (!whisperAvailable()) return null;
  const client = getSTTClient();
  if (!client) return null;
  // A canonical WAV has a 44-byte header; the worker wants the raw 16 kHz samples after it.
  const pcm = wav.subarray(44);
  return (await client.transcribe(Buffer.from(pcm))).replace(/\s+/g, " ").trim();
}
