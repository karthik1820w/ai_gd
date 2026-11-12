import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RUBRIC_KEYS, blendExaminer, computeRubric, parseRubricWeights } from "../src/server/rubric.ts";
import { scoreParticipant, type ScoreInput } from "../src/server/scoring.ts";

const base: ScoreInput = {
  contributions: [
    { wordCount: 20, relevance: "HIGHLY_RELEVANT", communication: 80, knowledge: 80, reasoning: 76, respondsToOthers: true, positiveContribution: true },
    { wordCount: 15, relevance: "RELEVANT", communication: 80, knowledge: 68, reasoning: 52, respondsToOthers: false, positiveContribution: true },
    { wordCount: 12, relevance: "RELEVANT", communication: 80, knowledge: 68, reasoning: 76, respondsToOthers: true, positiveContribution: true },
  ],
  speakingMs: 40_000, totalSpeakingMs: 120_000, participantCount: 4,
  missed: { noResponse: 0, muted: 0, technical: 0, hostLocked: 0, disconnect: 0 },
  mediaReady: true, speechAvailable: true, blockingTechnical: false,
};

describe("rubric weights", () => {
  it("defaults to the published 25/20/20/15/10/10 split", () => {
    const { weights, source } = parseRubricWeights("");
    assert.equal(source, "default");
    assert.deepEqual(RUBRIC_KEYS.map((k) => Math.round(weights[k] * 100)), [25, 20, 20, 15, 10, 10]);
  });
  it("accepts five numbers and normalises them (no listening criterion)", () => {
    const { weights } = parseRubricWeights("25,20,20,15,10");
    assert.equal(weights.listening, 0);
    assert.ok(Math.abs(RUBRIC_KEYS.reduce((s, k) => s + weights[k], 0) - 1) < 1e-9);
    assert.ok(Math.abs(weights.topicRelevance - 25 / 90) < 1e-9);
  });
  it("falls back on bad input", () => {
    for (const bad of ["a,b,c,d,e", "1,2,3", "-1,2,3,4,5,6", "0,0,0,0,0,0"]) assert.equal(parseRubricWeights(bad).source, "default");
  });
});

describe("rubric score", () => {
  const scored = scoreParticipant(base);
  it("matches the weighted sum of the criteria", () => {
    const { weights } = parseRubricWeights("");
    const r = computeRubric({ scored, weights });
    const expected = RUBRIC_KEYS.reduce((s, k) => s + (r.parameters.find((p) => p.key === k)!.score ?? 0) * weights[k], 0);
    assert.ok(Math.abs((r.overall ?? 0) - expected) < 0.2);
    assert.equal(r.parameters.length, 6);
  });
  it("uses transcript clarity when supplied", () => {
    const low = computeRubric({ scored, communication: 30 });
    const high = computeRubric({ scored, communication: 95 });
    assert.ok((high.overall ?? 0) > (low.overall ?? 0));
    assert.match(high.parameters.find((p) => p.key === "communication")!.explanation, /generated transcript/);
  });
  it("drops zero-weight criteria from the parameter list", () => {
    const r = computeRubric({ scored, weights: parseRubricWeights("25,20,20,15,10").weights });
    assert.equal(r.parameters.length, 5);
    assert.ok(!r.parameters.some((p) => p.key === "listening"));
  });
  it("leaves the overall score empty when the report is incomplete", () => {
    const incomplete = scoreParticipant({ ...base, contributions: [], speechAvailable: false });
    const r = computeRubric({ scored: incomplete });
    assert.equal(r.incomplete, true);
    assert.equal(r.overall, null);
    assert.equal(r.category, "Incomplete");
  });
  it("scores only participation when nobody spoke but the mic worked", () => {
    const silent = scoreParticipant({ ...base, contributions: [], speakingMs: 0 });
    const r = computeRubric({ scored: silent });
    assert.equal(r.incomplete, false);
    assert.ok((r.overall ?? 99) < 5);
  });
  it("blends examiner 65/35", () => {
    assert.equal(blendExaminer(80, 60), 73);
    assert.equal(blendExaminer(null, 60), 60);
  });
});
