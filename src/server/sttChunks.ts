/**
 * Helpers for transcribing a recording on the server (pure, no I/O).
 * Input is 16 kHz mono signed 16-bit PCM, the format the STT worker expects.
 */

export const SAMPLE_RATE = 16_000;
const FRAME = 320; // 20 ms

export type Chunk = { startSample: number; endSample: number };

function frameRms(pcm: Int16Array, from: number, to: number) {
  let sum = 0;
  const end = Math.min(to, pcm.length);
  for (let i = from; i < end; i++) sum += pcm[i] * pcm[i];
  const n = Math.max(1, end - from);
  return Math.sqrt(sum / n);
}

/** RMS over a sample range, on the int16 scale (0-32768). */
export function rms(pcm: Int16Array, from = 0, to = pcm.length) {
  return frameRms(pcm, from, to);
}

/**
 * Split into windows of at most `maxSec` seconds (Whisper handles 30 s).
 * Each cut is placed at the quietest 20 ms frame in the last `searchSec` of the
 * window, so words are not sliced in half. Chunks that are almost silent are dropped.
 */
export function planChunks(
  pcm: Int16Array,
  options: { maxSec?: number; searchSec?: number; silenceRms?: number; minSec?: number } = {},
): Chunk[] {
  const maxSamples = Math.round((options.maxSec ?? 25) * SAMPLE_RATE);
  const searchSamples = Math.round((options.searchSec ?? 4) * SAMPLE_RATE);
  const silenceRms = options.silenceRms ?? 150; // ~0.5% of full scale
  const minSamples = Math.round((options.minSec ?? 0.4) * SAMPLE_RATE);
  const chunks: Chunk[] = [];
  let start = 0;
  while (start < pcm.length) {
    let end = Math.min(pcm.length, start + maxSamples);
    if (end < pcm.length) {
      let best = end;
      let bestEnergy = Number.POSITIVE_INFINITY;
      const from = Math.max(start + minSamples, end - searchSamples);
      for (let at = end - FRAME; at >= from; at -= FRAME) {
        const energy = frameRms(pcm, at, at + FRAME);
        if (energy < bestEnergy) {
          bestEnergy = energy;
          best = at + FRAME;
        }
      }
      end = best;
    }
    if (end - start >= minSamples && rms(pcm, start, end) >= silenceRms) chunks.push({ startSample: start, endSample: end });
    start = end;
  }
  return chunks;
}

export function pcmToBuffer(pcm: Int16Array, chunk: Chunk) {
  const view = pcm.subarray(chunk.startSample, chunk.endSample);
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

export type SttSegment = { text: string; offsetMs: number; durationMs: number };

/** Keep real words only; same noise rule as live capture (one word is dropped except yes/no/agree/disagree). */
export function keepTranscribed(text: string) {
  const clean = text.replace(/\[[^\]]*\]|\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  const words = clean.split(" ").length;
  if (words < 2 && !/^(yes|no|agree|disagree)\.?$/i.test(clean)) return null;
  return clean.slice(0, 2000);
}

export function toSegments(chunks: Chunk[], texts: string[]): SttSegment[] {
  const out: SttSegment[] = [];
  chunks.forEach((chunk, index) => {
    const text = keepTranscribed(texts[index] ?? "");
    if (!text) return;
    out.push({
      text,
      offsetMs: Math.round((chunk.startSample / SAMPLE_RATE) * 1000),
      durationMs: Math.round(((chunk.endSample - chunk.startSample) / SAMPLE_RATE) * 1000),
    });
  });
  return out;
}
