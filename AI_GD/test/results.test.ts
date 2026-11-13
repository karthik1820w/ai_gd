import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formulaText, groupSummaryView, personView } from "../src/server/resultsView.ts";

const points = [
  { kind: "CONCLUSION", body: "A balanced discussion.", sortOrder: 0 },
  { kind: "QUALITY", body: "Discussion quality: 72/100", sortOrder: 0 },
  { kind: "IDEA", body: "Rules help", sortOrder: 0 },
  { kind: "AGREEMENT", body: "Safety matters", sortOrder: 0 },
  { kind: "DISAGREEMENT", body: "Who enforces", sortOrder: 0 },
  { kind: "MISSED_TOPIC", body: "Cost", sortOrder: 0 },
  { kind: "BEST_CONTRIBUTION", body: "Aarav: Evidence-based", sortOrder: 0 },
];

describe("group summary privacy", () => {
  it("gives the host everything", () => {
    const view = groupSummaryView("gemini", points, true);
    assert.equal(view.bestContribution, "Aarav: Evidence-based");
    assert.deepEqual(view.keyInsights, ["Rules help"]);
  });
  it("never names a best contributor to a participant", () => {
    assert.equal(groupSummaryView("gemini", points, false).bestContribution, null);
  });
  it("keeps AI-written group insights for participants", () => {
    const view = groupSummaryView("gemini", points, false);
    assert.deepEqual(view.agreements, ["Safety matters"]);
    assert.deepEqual(view.missedTopics, ["Cost"]);
  });
  it("hides copied transcript lines from participants when AI did not write the summary", () => {
    const rows = [...points, { kind: "AGREEMENT", body: "Meera: I agree with the safety point", sortOrder: 1 }];
    const view = groupSummaryView("heuristic", rows, false);
    assert.deepEqual(view.agreements, []);
    assert.deepEqual(view.keyInsights, []);
    assert.equal(view.conclusion, "A balanced discussion.");
    assert.deepEqual(groupSummaryView("heuristic", rows, true).agreements.length, 2);
  });
});

describe("person view", () => {
  const base = { participantId: "p1", name: "Aarav", overallScore: 75, adjustedScore: null, category: "Strong", incomplete: false, incompleteReason: null, speakingMs: 3000, contributionCount: 2, parameters: [{ key: "k", label: "Knowledge", weight: 0.4, score: 79 }] };
  it("prefers the host-adjusted score", () => {
    assert.equal(personView({ ...base, adjustedScore: 80, notes: [] }).score, 80);
    assert.equal(personView({ ...base, notes: [] }).score, 75);
  });
  it("splits notes into strengths, improvements, covered and missed concepts", () => {
    const view = personView({ ...base, notes: [
      { kind: "STRENGTH", body: "Clear reasoning" }, { kind: "IMPROVEMENT", body: "More examples" },
      { kind: "REMARK", body: "Concept covered: regulation" }, { kind: "REMARK", body: "Concept to explore: bias" }, { kind: "REMARK", body: "Evaluated by Gemini." },
    ] });
    assert.deepEqual([view.strengths, view.improvements, view.covered, view.missed], [["Clear reasoning"], ["More examples"], ["regulation"], ["bias"]]);
  });
  it("describes the scoring formula", () => {
    assert.equal(formulaText([{ label: "Topic relevance", weight: 0.25 }, { label: "Communication and clarity", weight: 0.2 }]), "Overall = 25% topic relevance + 20% communication and clarity");
  });
});
