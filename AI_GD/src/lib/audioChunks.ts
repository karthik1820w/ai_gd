/**
 * Audio helpers for the fallback transcription path (pure, no browser or server APIs).
 *
 * When a person's browser cannot transcribe speech itself, their microphone is cut into short spoken
 * clips (at natural pauses, never in silence) and each clip is sent to the server as a small WAV file.
 */

export const TARGET_RATE = 16_000;
const FRAME_MS = 20;

/** Float samples at any rate to 16-bit mono at the target rate (averaging, so no aliasing noise). */
export function downsample(input: Float32Array, fromRate: number, toRate = TARGET_RATE): Int16Array {
  if (fromRate < toRate) throw new Error("Cannot upsample.");
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    out[i] = Math.round(value < 0 ? value * 0x8000 : value * 0x7fff);
  }
  return out;
}

/** A canonical 44-byte-header PCM WAV file (16-bit, mono). */
export function encodeWav(pcm: Int16Array, sampleRate = TARGET_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => { for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i += 1) view.setInt16(44 + i * 2, pcm[i], true);
  return bytes;
}

export type WavInfo = { ok: true; sampleRate: number; seconds: number } | { ok: false; reason: string };

/** Server-side check of an upload: only our own canonical 16-bit mono WAV, of a sensible length. */
export function wavInfo(bytes: Uint8Array, limits: { maxSeconds?: number } = {}): WavInfo {
  if (bytes.length < 44) return { ok: false, reason: "That is not an audio clip." };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE" || tag(12) !== "fmt " || tag(36) !== "data") return { ok: false, reason: "That is not a WAV clip." };
  if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint16(34, true) !== 16) return { ok: false, reason: "The clip must be 16-bit mono." };
  const sampleRate = view.getUint32(24, true);
  if (sampleRate < 8_000 || sampleRate > 48_000) return { ok: false, reason: "Unsupported sample rate." };
  const dataBytes = view.getUint32(40, true);
  if (dataBytes !== bytes.length - 44) return { ok: false, reason: "The clip is damaged." };
  const seconds = dataBytes / 2 / sampleRate;
  if (seconds > (limits.maxSeconds ?? 20)) return { ok: false, reason: "The clip is too long." };
  if (seconds < 0.4) return { ok: false, reason: "The clip is too short." };
  return { ok: true, sampleRate, seconds };
}

export type SpokenClip = { samples: Int16Array; durationMs: number; voicedMs: number };

export type ChunkerOptions = {
  rate?: number;
  /** Cut a clip at this length even if the person has not paused. */
  maxMs?: number;
  /** A clip needs this much actual speech, or it is dropped as noise. */
  minVoicedMs?: number;
  /** A pause this long ends a clip. */
  endSilenceMs?: number;
  /** Frame loudness (RMS on the 16-bit scale) that counts as speech. */
  voicedRms?: number;
  /** Quiet lead-in kept before the first sound, so words are not clipped. */
  preRollMs?: number;
};

/** Cuts a stream of 16 kHz samples into spoken clips. Silence is never sent. */
export class SpeechChunker {
  private readonly frameSize: number;
  private readonly maxFrames: number;
  private readonly minVoicedFrames: number;
  private readonly endSilenceFrames: number;
  private readonly preRollFrames: number;
  private readonly voicedRms: number;
  private pending = new Int16Array(0);
  private preRoll: Int16Array[] = [];
  private frames: Int16Array[] = [];
  private voiced = 0;
  private trailing = 0;
  private active = false;

  constructor(options: ChunkerOptions = {}) {
    const rate = options.rate ?? TARGET_RATE;
    this.frameSize = Math.round((rate * FRAME_MS) / 1000);
    this.maxFrames = Math.round((options.maxMs ?? 14_000) / FRAME_MS);
    this.minVoicedFrames = Math.round((options.minVoicedMs ?? 1_000) / FRAME_MS);
    this.endSilenceFrames = Math.round((options.endSilenceMs ?? 700) / FRAME_MS);
    this.preRollFrames = Math.round((options.preRollMs ?? 300) / FRAME_MS);
    this.voicedRms = options.voicedRms ?? 350;
  }

  push(samples: Int16Array): SpokenClip[] {
    const joined = new Int16Array(this.pending.length + samples.length);
    joined.set(this.pending);
    joined.set(samples, this.pending.length);
    const clips: SpokenClip[] = [];
    let offset = 0;
    while (offset + this.frameSize <= joined.length) {
      const clip = this.frame(joined.slice(offset, offset + this.frameSize));
      if (clip) clips.push(clip);
      offset += this.frameSize;
    }
    this.pending = joined.slice(offset);
    return clips;
  }

  /** Emit whatever speech is waiting (at the end of the discussion). */
  flush(): SpokenClip | null {
    return this.active && this.voiced >= this.minVoicedFrames ? this.emit() : this.reset();
  }

  private frame(frame: Int16Array): SpokenClip | null {
    let sum = 0;
    for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
    const loud = Math.sqrt(sum / frame.length) >= this.voicedRms;
    if (!this.active) {
      if (!loud) {
        this.preRoll.push(frame);
        if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
        return null;
      }
      this.active = true;
      this.frames = [...this.preRoll];
      this.preRoll = [];
    }
    this.frames.push(frame);
    if (loud) { this.voiced += 1; this.trailing = 0; } else this.trailing += 1;
    if (this.frames.length >= this.maxFrames) return this.voiced >= this.minVoicedFrames ? this.emit() : this.reset();
    if (this.trailing >= this.endSilenceFrames) return this.voiced >= this.minVoicedFrames ? this.emit() : this.reset();
    return null;
  }

  private emit(): SpokenClip {
    const keepTrailing = Math.min(this.trailing, 10); // 200 ms of tail is enough
    const kept = this.frames.slice(0, this.frames.length - (this.trailing - keepTrailing));
    const samples = new Int16Array(kept.length * this.frameSize);
    kept.forEach((frame, index) => samples.set(frame, index * this.frameSize));
    const clip = { samples, durationMs: kept.length * FRAME_MS, voicedMs: this.voiced * FRAME_MS };
    this.reset();
    return clip;
  }

  private reset(): null {
    this.frames = [];
    this.voiced = 0;
    this.trailing = 0;
    this.active = false;
    return null;
  }
}
