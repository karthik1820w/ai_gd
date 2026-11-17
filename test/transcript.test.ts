import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTranscript, formatSrt, formatText, formatMarkdown, renderTranscript, clock } from "../src/server/transcript.ts";

const T0 = Date.parse("2026-01-01T10:00:00Z");
const seg = (participantId: string, name: string, text: string, startSec: number, endSec: number, source = "live") => ({
  id: `${participantId}-${startSec}`, participantId, name, text,
  startedAt: new Date(T0 + startSec * 1000), endedAt: new Date(T0 + endSec * 1000), source,
});

describe("transcript generator", () => {
  const segments = [
    seg("a", "Asha", "AI can personalise learning", 5, 8),
    seg("a", "Asha", "for each student", 9, 11),          // same speaker, 1 s gap -> merged
    seg("b", "Ravi", "I disagree with that point", 14, 17),
    seg("a", "Asha", "Later I want to add something", 60, 64), // 43 s gap -> new turn
  ];
  const doc = buildTranscript({ title: "AI GD", topic: "AI in education", startedAt: T0, segments });

  it("merges close fragments from the same speaker into one turn", () => {
    assert.equal(doc.turns.length, 3);
    assert.equal(doc.turns[0].text, "AI can personalise learning for each student");
    assert.deepEqual(doc.turns[0].segmentIds.length, 2);
  });

  it("orders turns by time even when input is shuffled", () => {
    const shuffled = buildTranscript({ title: "t", topic: "t", startedAt: T0, segments: [...segments].reverse() });
    assert.deepEqual(shuffled.turns.map((t) => t.speaker), ["Asha", "Ravi", "Asha"]);
  });

  it("computes offsets and per-speaker shares", () => {
    assert.equal(doc.turns[1].offsetSec, 14);
    const asha = doc.speakers.find((s) => s.speaker === "Asha")!;
    assert.equal(asha.turns, 2);
    assert.equal(asha.words, 7 + 6);
    const share = doc.speakers.reduce((sum, s) => sum + s.sharePercent, 0);
    assert.ok(Math.abs(share - 100) < 0.2);
  });

  it("never reports a negative offset", () => {
    const early = buildTranscript({ title: "t", topic: "t", startedAt: T0 + 100_000, segments });
    assert.ok(early.turns.every((t) => t.offsetSec >= 0));
  });

  it("scores clarity on merged turns, so fragments are not punished", () => {
    const fragments = [seg("a", "Asha", "AI helps", 1, 2), seg("a", "Asha", "students learn", 3, 4), seg("a", "Asha", "at their own pace", 5, 6)];
    const merged = buildTranscript({ title: "t", topic: "t", startedAt: T0, segments: fragments });
    const split = buildTranscript({ title: "t", topic: "t", startedAt: T0, segments: fragments, mergeGapMs: 0 });
    assert.ok((merged.speakers[0].clarity ?? 0) > (split.speakers[0].clarity ?? 0));
  });

  it("handles an empty discussion", () => {
    const empty = buildTranscript({ title: "t", topic: "t", segments: [] });
    assert.equal(empty.turns.length, 0);
    assert.match(formatText(empty), /No speech was captured/);
  });

  it("marks lines generated from recordings", () => {
    const mixed = buildTranscript({ title: "t", topic: "t", startedAt: T0, segments: [seg("c", "Mia", "hello everyone here", 2, 4, "recording")] });
    assert.equal(mixed.turns[0].source, "recording");
    assert.match(formatText(mixed), /\(from recording\)/);
  });

  it("renders text, markdown, srt and json", () => {
    assert.match(formatText(doc), /\[00:05\] Asha: AI can personalise/);
    assert.match(formatMarkdown(doc), /\| Asha \| 2 \|/);
    assert.match(formatSrt(doc), /1\n00:00:05,000 --> 00:00:11,000\nAsha:/);
    assert.equal(JSON.parse(renderTranscript(doc, "json").body).turns.length, 3);
  });

  it("formats clocks", () => {
    assert.equal(clock(65), "01:05");
    assert.equal(clock(3725), "1:02:05");
  });
});
