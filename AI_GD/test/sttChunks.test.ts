import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SAMPLE_RATE, planChunks, keepTranscribed, toSegments } from "../src/server/sttChunks.ts";

function tone(seconds: number, amp = 4000) {
  const a = new Int16Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = 0; i < a.length; i++) a[i] = Math.round(Math.sin(i / 7) * amp);
  return a;
}
const concat = (...parts: Int16Array[]) => { const out = new Int16Array(parts.reduce((s, p) => s + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

describe("recording chunking", () => {
  it("drops silent audio", () => {
    assert.equal(planChunks(new Int16Array(SAMPLE_RATE * 10)).length, 0);
  });
  it("keeps short speech as one chunk", () => {
    assert.equal(planChunks(tone(5)).length, 1);
  });
  it("cuts long speech at a pause, within the max window", () => {
    const pcm = concat(tone(22), new Int16Array(SAMPLE_RATE), tone(20));
    const chunks = planChunks(pcm, { maxSec: 25 });
    assert.equal(chunks.length, 2);
    assert.ok(chunks.every((c) => (c.endSample - c.startSample) / SAMPLE_RATE <= 25.01));
    const cutSec = chunks[0].endSample / SAMPLE_RATE;
    assert.ok(cutSec >= 22 && cutSec <= 23.1, `cut at ${cutSec}`);
  });
  it("covers all audio when speech is continuous", () => {
    const chunks = planChunks(tone(60));
    assert.equal(chunks[0].startSample, 0);
    assert.equal(chunks.at(-1)!.endSample, 60 * SAMPLE_RATE);
  });
});

describe("STT text filtering", () => {
  it("strips Whisper annotations and one-word noise", () => {
    assert.equal(keepTranscribed("[BLANK_AUDIO]"), null);
    assert.equal(keepTranscribed("Um"), null);
    assert.equal(keepTranscribed("Yes."), "Yes.");
    assert.equal(keepTranscribed(" AI helps   students [music] learn "), "AI helps students learn");
  });
  it("maps chunks to timed segments", () => {
    const segs = toSegments([{ startSample: SAMPLE_RATE * 10, endSample: SAMPLE_RATE * 20 }], ["Education needs new tools"]);
    assert.deepEqual(segs, [{ text: "Education needs new tools", offsetMs: 10_000, durationMs: 10_000 }]);
  });
});
