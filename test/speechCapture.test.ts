import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SpeechAssembler, type CaptureLine, type RecognitionPiece } from "../src/lib/speechCapture.ts";

const r = (transcript: string, isFinal = true): RecognitionPiece => ({ transcript, isFinal });
/** Run an event script, polling `due` every 100 ms like the browser does. Returns every line sent. */
function run(events: Array<{ at: number; results?: RecognitionPiece[]; newSession?: boolean }>, endAt = 20_000) {
  const a = new SpeechAssembler();
  const lines: CaptureLine[] = [];
  const captions: string[] = [];
  let next = 0;
  for (let t = 0; t <= endAt; t += 100) {
    while (next < events.length && events[next].at <= t) {
      const e = events[next++];
      if (e.newSession) a.newSession();
      if (e.results) captions.push(a.push(e.results, e.at).caption);
    }
    const line = a.due(t);
    if (line) lines.push(line);
  }
  const rest = a.drain(endAt);
  if (rest) lines.push(rest);
  return { lines, captions };
}

describe("speech assembler", () => {
  it("sends a finished phrase quickly, not after a long wait", () => {
    const { lines } = run([{ at: 1000, results: [r("regulation is needed")] }]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, "regulation is needed");
    assert.ok(lines[0].endedAt <= 1500, `sent at ${lines[0].endedAt}`);
  });

  it("starts a line when the first word was heard, not when it was finished", () => {
    const { lines } = run([
      { at: 2000, results: [r("regulation is", false)] },
      { at: 3500, results: [r("regulation is needed because of bias")] },
    ]);
    assert.equal(lines[0].startedAt, 2000);
    assert.ok(lines[0].endedAt - lines[0].startedAt >= 1500);
  });

  it("shows live caption words before they are final", () => {
    const { captions } = run([{ at: 1000, results: [r("small start", false)] }, { at: 1500, results: [r("small startups need rules", false)] }]);
    assert.deepEqual(captions, ["small start", "small startups need rules"]);
  });

  it("joins several quick finals into one line", () => {
    const { lines } = run([
      { at: 1000, results: [r("first part")] },
      { at: 1200, results: [r("first part"), r("second part")] },
    ]);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].text, "first part second part");
  });

  it("does not repeat words when Android re-sends earlier results", () => {
    const { lines } = run([
      { at: 1000, results: [r("good morning everyone")] },
      { at: 3000, results: [r("good morning everyone"), r("today we discuss AI")] },
      { at: 6000, results: [r("good morning everyone"), r("today we discuss AI"), r("rules matter")] },
    ]);
    assert.equal(lines.map((l) => l.text).join(" | "), "good morning everyone | today we discuss AI | rules matter");
  });

  it("does not repeat words when one result keeps growing and is marked final each time", () => {
    const { lines } = run([
      { at: 1000, results: [r("hi")] },
      { at: 1300, results: [r("hi how")] },
      { at: 1600, results: [r("hi how are you")] },
    ]);
    assert.equal(lines.map((l) => l.text).join(" "), "hi how are you");
  });

  it("starts counting again after the recogniser restarts", () => {
    const { lines } = run([
      { at: 1000, results: [r("before the restart")] },
      { at: 4000, newSession: true },
      { at: 4500, results: [r("after the restart")] },
    ]);
    assert.deepEqual(lines.map((l) => l.text), ["before the restart", "after the restart"]);
  });

  it("sends a long speech in pieces while the person is still talking", () => {
    const events = [];
    for (let i = 0; i < 12; i += 1) events.push({ at: 1000 + i * 500, results: Array.from({ length: i + 1 }, (_, k) => r(`sentence number ${k} of the speech`)) });
    const { lines } = run(events, 8_000);
    assert.ok(lines.length >= 2, "should not hold everything until the end");
    assert.equal((lines.map((l) => l.text).join(" ").match(/sentence number/g) ?? []).length, 12);
  });

  it("keeps words waiting when the session closes", () => {
    const a = new SpeechAssembler();
    a.push([r("last words before leaving")], 1000);
    assert.equal(a.drain(1100)?.text, "last words before leaving");
    assert.equal(a.drain(1200), null);
  });
});
