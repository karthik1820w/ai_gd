/**
 * Turns the raw events of the browser's speech recogniser into finished transcript lines, in real time.
 * Pure (no timers, no DOM), so the awkward cases can be tested.
 *
 * Things the browser does that used to lose or repeat words:
 *  - Android Chrome re-sends earlier results on every event, or grows one result ("hi", "hi how", "hi how are")
 *    and marks each version final. Taking every final at face value repeats the words many times.
 *  - A recognition session ends on its own after a pause. The next session starts its results list from zero.
 *  - Waiting for a long quiet gap before sending delays the line the host is watching.
 */

export type RecognitionPiece = { transcript: string; isFinal: boolean };
export type CaptureLine = { text: string; startedAt: number; endedAt: number };

export type AssemblerOptions = {
  /** Send a line this long after the last final result (ms). */
  quietMs?: number;
  /** Never hold words longer than this (ms), so a long speech still shows up as it goes. */
  maxHoldMs?: number;
  /** Send at once when this many words are waiting. */
  maxWords?: number;
};

const norm = (text: string) => text.replace(/\s+/g, " ").trim();
const words = (text: string) => (text ? text.split(" ").length : 0);

let captureIdSequence = 0;

/** Diagnostic correlation only; this ID is not an authorization or security token. */
export function createCaptureId(cryptoProvider: { randomUUID?: () => string } | null = globalThis.crypto) {
  try {
    if (typeof cryptoProvider?.randomUUID === "function") return cryptoProvider.randomUUID();
  } catch {
    // Insecure contexts may expose crypto without allowing randomUUID.
  }
  captureIdSequence += 1;
  return `capture-${Date.now().toString(36)}-${captureIdSequence.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class SpeechAssembler {
  private readonly quietMs: number;
  private readonly maxHoldMs: number;
  private readonly maxWords: number;
  /** For each result index of the current session, the final text already taken (so nothing is taken twice). */
  private seen: string[] = [];
  private pending = "";
  private pendingStart = 0;
  private phraseStart = 0;
  private lastFinalAt = 0;

  constructor(options: AssemblerOptions = {}) {
    this.quietMs = options.quietMs ?? 350;
    this.maxHoldMs = options.maxHoldMs ?? 4_000;
    this.maxWords = options.maxWords ?? 30;
  }

  /** A new recognition session began (its results list starts again from zero). */
  newSession() {
    this.seen = [];
  }

  /**
   * Feed one recogniser event: the whole results list. Returns the words being spoken right now (not final),
   * for the live caption, including words already waiting to be sent.
   */
  push(results: RecognitionPiece[], now: number): { caption: string } {
    let interim = "";
    for (let i = 0; i < results.length; i += 1) {
      const text = norm(results[i].transcript);
      if (!results[i].isFinal) { interim = norm(`${interim} ${text}`); continue; }
      this.takeFinal(i, text, now);
    }
    if (interim && !this.phraseStart) this.phraseStart = now;
    return { caption: norm(`${this.pending} ${interim}`) };
  }

  private takeFinal(index: number, text: string, now: number) {
    if (!text) return;
    const before = this.seen[index];
    let fresh = text;
    if (before !== undefined) {
      const old = before.toLowerCase();
      const lower = text.toLowerCase();
      if (lower === old) return; // the same result sent again
      if (lower.startsWith(`${old} `)) fresh = norm(text.slice(before.length)); // this result grew: take only the new words
    }
    this.seen[index] = text;
    if (!fresh) return;
    if (!this.pending) this.pendingStart = this.phraseStart || now;
    this.phraseStart = 0;
    this.pending = norm(`${this.pending} ${fresh}`);
    this.lastFinalAt = now;
  }

  /** Call often (every ~100 ms). Returns a line when it is time to send one. */
  due(now: number): CaptureLine | null {
    if (!this.pending) return null;
    const quiet = now - this.lastFinalAt >= this.quietMs;
    const held = now - this.pendingStart >= this.maxHoldMs;
    if (quiet || held || words(this.pending) >= this.maxWords) return this.take(now);
    return null;
  }

  /** The session is closing: send whatever is waiting. */
  drain(now: number): CaptureLine | null {
    return this.pending ? this.take(now) : null;
  }

  private take(now: number): CaptureLine {
    const line = { text: this.pending, startedAt: this.pendingStart, endedAt: Math.max(now, this.pendingStart) };
    this.pending = "";
    this.pendingStart = 0;
    return line;
  }
}
