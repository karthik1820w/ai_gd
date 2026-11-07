import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WEIGHTS, classifyStatement, scoreParticipant } from "../src/server/scoring.ts";

const topic = "Impact of Artificial Intelligence on Education";
const description = "How AI changes teaching and learning";

describe("topic relevance", () => {
  it("treats a learning example as on topic", () => {
    const result = classifyStatement({
      topic,
      description,
      text: "AI can provide personalised learning experiences based on individual student performance.",
    });
    assert.ok(result.relevance === "HIGHLY_RELEVANT" || result.relevance === "RELEVANT");
    assert.match(result.reason, /topic/i);
  });

  it("treats an unrelated sports remark as irrelevant", () => {
    const result = classifyStatement({
      topic,
      description,
      text: "Cricket is one of the most popular sports in India.",
    });
    assert.equal(result.relevance, "IRRELEVANT");
  });

  it("keeps a reply relevant when it answers an on-topic point", () => {
    const result = classifyStatement({
      topic,
      description,
      speakerId: "priya",
      secondsSincePrevious: 8,
      previous: [{ speakerId: "rahul", relevance: "HIGHLY_RELEVANT", text: "AI can provide personalised learning experiences." }],
      text: "I agree with that point, and schools still need to protect student data.",
    });
    assert.notEqual(result.relevance, "IRRELEVANT");
    assert.equal(result.respondsToOthers, true);
  });
});

describe("performance scores", () => {
  it("weights the six parameters to 100 percent", () => {
    const total = Object.values(WEIGHTS).reduce((sum, weight) => sum + weight, 0);
    assert.ok(Math.abs(total - 1) < 1e-9);
  });

  it("gives a low participation score when someone never speaks", () => {
    const silent = scoreParticipant({
      contributions: [],
      speakingMs: 0,
      totalSpeakingMs: 90_000,
      participantCount: 4,
      missed: { noResponse: 0, muted: 0, technical: 0, hostLocked: 0, disconnect: 0 },
      mediaReady: true,
      speechAvailable: true,
      blockingTechnical: false,
    });
    assert.equal(silent.incomplete, false);
    assert.ok(silent.participation < 25);
    assert.equal(silent.topicRelevance, 0);
    assert.equal("accent" in silent, false);
  });

  it("does not assign a failing content score when speech recognition is unavailable", () => {
    const blocked = scoreParticipant({
      contributions: [],
      speakingMs: 0,
      totalSpeakingMs: 90_000,
      participantCount: 4,
      missed: { noResponse: 0, muted: 0, technical: 1, hostLocked: 0, disconnect: 0 },
      mediaReady: false,
      speechAvailable: false,
      blockingTechnical: true,
    });
    assert.equal(blocked.incomplete, true);
    assert.equal(blocked.overall, null);
    assert.match(blocked.incompleteReason ?? "", /speech recognition/i);
  });

  it("does not penalise a muted invitation after enough contribution", () => {
    const contribution = {
      wordCount: 18,
      relevance: "HIGHLY_RELEVANT" as const,
      communication: 80,
      knowledge: 78,
      reasoning: 74,
      respondsToOthers: true,
      positiveContribution: true,
    };
    const base = {
      contributions: [contribution, contribution, contribution],
      speakingMs: 90_000,
      totalSpeakingMs: 120_000,
      participantCount: 3,
      mediaReady: true,
      speechAvailable: true,
      blockingTechnical: false,
    };
    const withMute = scoreParticipant({ ...base, missed: { noResponse: 0, muted: 2, technical: 0, hostLocked: 0, disconnect: 0 } });
    const clear = scoreParticipant({ ...base, missed: { noResponse: 0, muted: 0, technical: 0, hostLocked: 0, disconnect: 0 } });
    assert.equal(withMute.participation, clear.participation);
    const expected =
      (withMute.topicRelevance ?? 0) * WEIGHTS.topicRelevance +
      (withMute.communication ?? 0) * WEIGHTS.communication +
      (withMute.knowledge ?? 0) * WEIGHTS.knowledge +
      withMute.participation * WEIGHTS.participation +
      (withMute.reasoning ?? 0) * WEIGHTS.reasoning +
      (withMute.listening ?? 0) * WEIGHTS.listening;
    assert.ok(Math.abs((withMute.overall ?? 0) - expected) < 0.2);
  });
});
