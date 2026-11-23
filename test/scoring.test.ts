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

  it("gives a silent participant exactly the join baseline", () => {
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
    assert.equal(silent.participation, 5);
    assert.equal(silent.topicRelevance, null);
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
    assert.equal(blocked.participation, 5);
    assert.equal(blocked.sttIssue, true);
    assert.match(blocked.incompleteReason ?? "", /speech recognition/i);
  });

  it("scores only measured participation and caps a monopolizing monologue", () => {
    const flags = { mediaReady: true, speechAvailable: true, blockingTechnical: false };
    const missed = { noResponse: 0, muted: 0, technical: 0, hostLocked: 0, disconnect: 0 };
    const short = scoreParticipant({
      contributions: [{ wordCount: 3, relevance: "RELEVANT", communication: 70, knowledge: 65, reasoning: 60, respondsToOthers: false, positiveContribution: true }],
      speakingMs: 6_000, totalSpeakingMs: 24_000, participantCount: 4, missed, ...flags,
    });
    const balanced = scoreParticipant({
      contributions: Array.from({ length: 4 }, () => ({ wordCount: 20, relevance: "RELEVANT" as const, communication: 80, knowledge: 80, reasoning: 75, respondsToOthers: true, positiveContribution: true })),
      speakingMs: 200_000, totalSpeakingMs: 800_000, participantCount: 4, missed, ...flags,
    });
    const monologue = scoreParticipant({
      contributions: Array.from({ length: 20 }, () => ({ wordCount: 20, relevance: "RELEVANT" as const, communication: 80, knowledge: 80, reasoning: 75, respondsToOthers: true, positiveContribution: true })),
      speakingMs: 800_000, totalSpeakingMs: 1_000_000, participantCount: 4, missed, ...flags,
    });
    assert.ok(short.participation > 5);
    assert.ok(short.participation < balanced.participation);
    assert.ok(monologue.participation < 100);
  });

  it("does not change participation when only technical flags change", () => {
    const base = { contributions: [], speakingMs: 0, totalSpeakingMs: 0, participantCount: 4, missed: { noResponse: 0, muted: 0, technical: 0, hostLocked: 0, disconnect: 0 }, mediaReady: true, speechAvailable: true, blockingTechnical: false };
    const clean = scoreParticipant(base);
    const flagged = scoreParticipant({ ...base, missed: { ...base.missed, technical: 1 }, mediaReady: false, speechAvailable: false, blockingTechnical: true });
    assert.equal(clean.participation, 5);
    assert.equal(flagged.participation, 5);
    assert.equal(clean.sttIssue, false);
    assert.equal(flagged.sttIssue, true);
  });

  it("does not claim a technical issue happened before speech when chronology was not checked", () => {
    const flagged = scoreParticipant({
      contributions: [], speakingMs: 0, totalSpeakingMs: 0, participantCount: 2,
      missed: { noResponse: 0, muted: 0, technical: 1, hostLocked: 0, disconnect: 0 },
      mediaReady: true, speechAvailable: true, blockingTechnical: true,
    });
    assert.equal(flagged.incomplete, true);
    assert.match(flagged.incompleteReason ?? "", /No scorable contribution was available/);
    assert.doesNotMatch(flagged.incompleteReason ?? "", /before any contribution/i);
  });

  it("keeps captured contributions scorable even when a technical issue was also logged", () => {
    const scored = scoreParticipant({
      contributions: [{ wordCount: 10, relevance: "RELEVANT", communication: 75, knowledge: 70, reasoning: 65, respondsToOthers: false, positiveContribution: true }],
      speakingMs: 8_000, totalSpeakingMs: 20_000, participantCount: 2,
      missed: { noResponse: 0, muted: 0, technical: 1, hostLocked: 0, disconnect: 0 },
      mediaReady: true, speechAvailable: true, blockingTechnical: true,
    });
    assert.equal(scored.incomplete, false);
    assert.equal(scored.incompleteReason, null);
    assert.equal(scored.sttIssue, true);
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

describe("a person who spoke but was not transcribed", () => {
  const base = {
    contributions: [], totalSpeakingMs: 90_000, participantCount: 4,
    missed: { noResponse: 0, muted: 0, technical: 0, hostLocked: 0, disconnect: 0 },
    mediaReady: true, speechAvailable: true, blockingTechnical: false,
  };
  it("is reported as incomplete, with a participation score from speaking time and a clear reason", () => {
    const r = scoreParticipant({ ...base, speakingMs: 30_000 });
    assert.equal(r.incomplete, true);
    assert.equal(r.overall, null);
    assert.ok(r.participation > 5 && r.participation <= 30, `participation ${r.participation}`);
    assert.match(r.incompleteReason ?? "", /No words were transcribed/);
    assert.match(r.incompleteReason ?? "", /30 seconds/);
    assert.match(r.explanations.participation, /30 seconds of measured speaking time/);
  });
  it("scores more speaking time higher, within the cap", () => {
    const a = scoreParticipant({ ...base, speakingMs: 8_000 }).participation;
    const b = scoreParticipant({ ...base, speakingMs: 60_000 }).participation;
    assert.ok(b > a && b <= 30);
  });
  it("leaves genuine silence alone", () => {
    const r = scoreParticipant({ ...base, speakingMs: 1_000 });
    assert.equal(r.incomplete, false);
    assert.equal(r.participation, 5);
  });
});
