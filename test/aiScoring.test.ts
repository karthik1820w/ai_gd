import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { aiWeights, scoreAIPillars } from "../src/server/aiScoring.ts";

describe("Gemini three-pillar scoring", () => {
  it("normalizes configured weights and falls back on invalid values", () => {
    assert.deepEqual(aiWeights("40,25,35").weights, [0.4, 0.25, 0.35]);
    assert.deepEqual(aiWeights("bad,25,35").weights, [0.4, 0.25, 0.35]);
    assert.deepEqual(aiWeights("1e308,1e308,1e308").weights, [0.4, 0.25, 0.35]);
  });

  it("applies accuracy and relevance to knowledge and reasoning/novelty to thinking", () => {
    const accurate = scoreAIPillars({
      participation: 80,
      weights: [0.4, 0.25, 0.35],
      contributions: [{ understanding: 100, reasoning: 100, originality: 100, accuracy: "accurate", relevance: "HIGHLY_RELEVANT", respondsToOthers: true }],
    });
    const inaccurate = scoreAIPillars({
      participation: 80,
      weights: [0.4, 0.25, 0.35],
      contributions: [{ understanding: 100, reasoning: 100, originality: 100, accuracy: "inaccurate", relevance: "HIGHLY_RELEVANT", respondsToOthers: true }],
    });
    assert.equal(accurate.knowledge, 100);
    assert.equal(accurate.thinking, 100);
    assert.ok(accurate.overall > inaccurate.overall);
  });

  it("keeps a silent participant's knowledge and thinking at zero", () => {
    const result = scoreAIPillars({ participation: 55, contributions: [] });
    assert.equal(result.knowledge, 0);
    assert.equal(result.thinking, 0);
    assert.equal(result.overall, Math.round(55 * result.weights[1]));
  });
});

describe("scoring without an AI model", () => {
  const line = { understanding: 90, reasoning: 76, originality: 50, accuracy: "unverifiable", relevance: "HIGHLY_RELEVANT", respondsToOthers: false };
  it("does not mark down a strong on-topic line just because nothing could be fact-checked", () => {
    const heuristic = scoreAIPillars({ participation: 70, contributions: [line], aiAnalysed: false });
    const aiPath = scoreAIPillars({ participation: 70, contributions: [line] });
    assert.equal(heuristic.knowledge, 90, "the line's own knowledge score is used as it is");
    assert.equal(aiPath.knowledge, 72, "the AI path keeps its accuracy discount for unchecked claims");
  });
  it("still ranks a better line above a weaker one", () => {
    const strong = scoreAIPillars({ participation: 70, contributions: [{ ...line, understanding: 90 }], aiAnalysed: false });
    const weak = scoreAIPillars({ participation: 70, contributions: [{ ...line, understanding: 24, relevance: "IRRELEVANT" }], aiAnalysed: false });
    assert.ok(strong.knowledge > weak.knowledge + 40);
  });
});
