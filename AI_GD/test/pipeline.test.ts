import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyStatement, scoreParticipant, type PriorLine, type RelevanceLabel } from "../src/server/scoring.ts";
import { buildTranscript, filterBySpeaker } from "../src/server/transcript.ts";
import { computeRubric } from "../src/server/rubric.ts";

/**
 * A scripted four-person discussion run through the same steps as the live app:
 * captured lines -> generated transcript -> per-person scoring -> rubric score.
 */
const T0 = Date.parse("2026-03-01T10:00:00Z");
const topic = "Should artificial intelligence be used in school education?";
const description = "Discuss benefits and risks of AI tutoring, personalised learning, student data privacy and teacher roles.";

const script: Array<[string, string, number]> = [
  ["asha", "AI tutoring can personalise learning because it adapts questions to each student's pace.", 5],
  ["asha", "For example adaptive platforms give weaker students extra practice, which improves outcomes.", 14],
  ["ravi", "I agree, but student data privacy is a risk, since tutoring systems collect learning records.", 26],
  ["mia", "Honestly I watched a great football match yesterday, the weather was lovely too.", 40],
  ["asha", "That privacy concern is valid, therefore schools should require consent and limit data retention.", 52],
  ["ravi", "Teachers should stay in charge, because AI cannot judge a student's emotions or context.", 66],
  ["mia", "Pizza is my favourite food, anyone want to talk about holidays instead?", 80],
];

function run() {
  const segments = script.map(([who, text, at], index) => ({
    id: `s${index}`, participantId: who, name: who[0].toUpperCase() + who.slice(1), text,
    startedAt: T0 + at * 1000, endedAt: T0 + (at + 8) * 1000, source: "live" as const,
  }));
  const doc = buildTranscript({ title: "AI in education", topic, startedAt: T0, segments });
  const prior: PriorLine[] = [];
  const classified = new Map<string, ReturnType<typeof classifyStatement>[]>();
  for (const segment of segments) {
    const result = classifyStatement({ topic, description, text: segment.text, speakerId: segment.participantId, previous: prior, secondsSincePrevious: 10 });
    classified.set(segment.participantId, [...(classified.get(segment.participantId) ?? []), result]);
    prior.push({ speakerId: segment.participantId, text: segment.text } as PriorLine);
  }
  const people = ["asha", "ravi", "mia", "zed"]; // zed's microphone worked but he never spoke
  const speaking = (id: string) => doc.speakers.find((s) => s.speakerId === id)?.speakingMs ?? 0;
  const results = Object.fromEntries(people.map((id) => {
    const own = classified.get(id) ?? [];
    const scored = scoreParticipant({
      contributions: own.map((c, i) => ({
        wordCount: segments.filter((s) => s.participantId === id)[i].text.split(/\s+/).length,
        relevance: c.relevance as RelevanceLabel,
        communication: c.communication, knowledge: c.knowledge, reasoning: c.reasoning,
        respondsToOthers: c.respondsToOthers, positiveContribution: c.positiveContribution,
      })),
      speakingMs: speaking(id), totalSpeakingMs: doc.totals.speakingMs, participantCount: people.length,
      missed: { noResponse: 0, muted: 0, technical: 0, hostLocked: 0, disconnect: 0 },
      mediaReady: true, speechAvailable: true, blockingTechnical: false,
    });
    const clarity = doc.speakers.find((s) => s.speakerId === id)?.clarity ?? null;
    return [id, computeRubric({ scored, communication: clarity })];
  }));
  return { doc, results };
}

describe("end-to-end: transcript -> per-person score", () => {
  const { doc, results } = run();

  it("generates a separate transcript for each speaker", () => {
    assert.equal(filterBySpeaker(doc, "asha").turns.length, 2); // lines 1-2 are 1 s apart, so merged
    assert.ok(filterBySpeaker(doc, "asha").turns.every((t) => t.speakerId === "asha"));
    assert.equal(filterBySpeaker(doc, "zed").turns.length, 0);
    const sum = ["asha", "ravi", "mia", "zed"].reduce((n, id) => n + filterBySpeaker(doc, id).totals.words, 0);
    assert.equal(sum, doc.totals.words);
  });

  it("scores every person on all six criteria", () => {
    for (const id of ["asha", "ravi", "mia", "zed"]) {
      assert.equal(results[id].parameters.length, 6);
      assert.equal(results[id].incomplete, false);
    }
  });

  it("ranks relevant, knowledgeable speakers above off-topic and silent ones", () => {
    const o = (id: string) => results[id].overall ?? 0;
    assert.ok(o("asha") > o("mia"), `asha ${o("asha")} vs mia ${o("mia")}`);
    assert.ok(o("ravi") > o("mia"), `ravi ${o("ravi")} vs mia ${o("mia")}`);
    assert.ok(o("mia") > o("zed"), `mia ${o("mia")} vs zed ${o("zed")}`);
  });

  it("gives the off-topic speaker a low topic relevance", () => {
    const topicOf = (id: string) => results[id].parameters.find((p) => p.key === "topicRelevance")!.score ?? 0;
    assert.ok(topicOf("asha") > topicOf("mia") + 20);
  });
});
