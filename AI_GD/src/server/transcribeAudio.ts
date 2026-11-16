import { complete, parseJson } from "@/server/ai";
import { TRANSCRIBE_SCHEMA, TRANSCRIBE_SYSTEM } from "@/server/aiPrompts";

/**
 * Turn a short WAV clip into text with Gemini. Used only when a person's browser cannot transcribe
 * speech itself. Returns "" when there is no clear speech and null when AI is not configured.
 * Throws if the model call fails, so the caller can tell the person.
 */
export async function transcribeAudio(wav: Buffer): Promise<string | null> {
  const raw = await complete(TRANSCRIBE_SYSTEM, "Transcribe this audio clip.", {
    audio: { mimeType: "audio/wav", base64: wav.toString("base64") },
    responseSchema: TRANSCRIBE_SCHEMA,
    retries: 1,
    timeoutMs: 25_000,
  });
  if (raw === null) return null;
  return String(parseJson(raw).text ?? "").replace(/\s+/g, " ").trim();
}
