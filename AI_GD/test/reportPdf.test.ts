import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { buildCombinedPdf, buildIndividualPdf, buildTranscriptPdf, criteriaMath, pdfSafe, type ReportData, type ReportPerson } from "../src/server/reportPdf.ts";

const criteria = [
  { key: "topicRelevance", label: "Topic relevance", weight: 0.25, score: 62, explanation: "Word-weighted average of contribution relevance." },
  { key: "communication", label: "Communication and clarity", weight: 0.2, score: 84, explanation: "Judged from the generated transcript: whole speaking turns, sentence shape, and filler sounds. Accent is not an input." },
  { key: "knowledge", label: "Knowledge and content quality", weight: 0.2, score: 29, explanation: "Higher when contributions stay on topic and include examples or evidence." },
  { key: "participation", label: "Participation and initiative", weight: 0.15, score: 98, explanation: "Muted invitations were not penalised because this participant had already contributed a fair share." },
  { key: "reasoning", label: "Logical reasoning", weight: 0.1, score: 56, explanation: "Reasoning words and structure." },
  { key: "listening", label: "Listening and constructive engagement", weight: 0.1, score: 70, explanation: "Responds to what others said." },
];
const person = (over: Partial<ReportPerson>): ReportPerson => ({
  participantId: "p1", name: "Kumar", score: 65, originalScore: 65, adjusted: false, adjustmentReason: null, category: "Adequate",
  incomplete: false, incompleteReason: null, speakingMs: 3000, contributions: 6, participationPercent: 100, source: "heuristic", model: null,
  criteria, strengths: ["Clear reasoning"], improvements: ["Add more examples"], remark: "Kumar argued well.", covered: ["regulation"], missed: ["bias"],
  moderation: [], removed: null,
  turns: [
    { offsetSec: 6, speaker: "Kumar", text: "Regulation is needed because evidence shows bias in hiring tools.", source: "live" },
    { offsetSec: 20, speaker: "Kumar", text: "Small startups need clear and simple rules to follow.", source: "recording" },
  ], ...over,
});
const data: ReportData = {
  title: "Impact of generative AI", topic: "Impact of generative AI in creative fields", when: "14 Nov 2026, 7:58 am", durationMin: 30, hostName: "Host",
  evaluatedBy: "the built-in scoring", group: { source: "heuristic", conclusion: "A short discussion.", keyInsights: ["Balance matters"], agreements: [], disagreements: [], missedTopics: ["Cost"], bestContribution: "Kumar: evidence-based" },
  people: [
    person({}),
    person({ participantId: "p2", name: "Meena", score: null, originalScore: null, category: "Incomplete", incomplete: true, incompleteReason: "No speech was captured: this browser has no speech recognition.", speakingMs: 0, contributions: 0, participationPercent: 0, criteria: criteria.map((c) => ({ ...c, score: null })), strengths: [], improvements: [], remark: "", covered: [], missed: [], turns: [] }),
    person({ participantId: "p3", name: "Ravi", score: 31, originalScore: 31, category: "Limited", removed: { at: "10:42 am", reason: "Repeatedly interrupting others" }, moderation: [{ kind: "MIC_MUTED", at: "10:40 am", text: "The host muted this person's microphone." }, { kind: "REMOVED", at: "10:42 am", text: "The host removed this person." }] }),
  ],
  fullTranscript: [
    { offsetSec: 6, speaker: "Kumar", text: "Regulation is needed because evidence shows bias in hiring tools.", source: "live" },
    { offsetSec: 14, speaker: "Ravi", text: "I think everything should stay unregulated.", source: "live" },
  ],
  transcriptPurged: false,
};

function text(buffer: Buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), "pdf-"));
  const file = path.join(dir, "r.pdf");
  writeFileSync(file, buffer);
  return execFileSync("pdftotext", ["-layout", file, "-"]).toString();
}

describe("report PDF", () => {
  it("shows the score, the weights, the arithmetic and the explanations", async () => {
    const out = text((await buildIndividualPdf(data, "p1"))!);
    assert.match(out, /Individual performance report/);
    assert.match(out, /Score breakdown/);
    assert.match(out, /Communication and clarity\s+20%\s+84/);
    assert.match(out, /Accent is not an input/);
    assert.match(out, /How the score is calculated/);
    assert.match(out, /Excellent 85-100/);
    assert.match(out, /Overall \(sum of points\)\s+65\.4/);
  });

  it("includes the person's transcript and marks recording-derived lines", async () => {
    const out = text((await buildIndividualPdf(data, "p1"))!);
    assert.match(out, /Transcript \(what this score is based on\)/);
    assert.match(out, /\[00:06\] Regulation is needed because evidence shows bias/);
    assert.match(out, /\(from recording\)/);
  });

  it("never includes another person's words in an individual report", async () => {
    const out = text((await buildIndividualPdf(data, "p1"))!);
    assert.doesNotMatch(out, /unregulated/);
    assert.doesNotMatch(out, /Ravi/);
  });

  it("explains an incomplete report instead of printing an empty one", async () => {
    const out = text((await buildIndividualPdf(data, "p2"))!);
    assert.match(out, /Why this report is incomplete: No speech was captured/);
    assert.match(out, /No speech was captured\./);
  });

  it("records a removal and the host's actions in that person's report", async () => {
    const out = text((await buildIndividualPdf(data, "p3"))!);
    assert.match(out, /Removed by the host/);
    assert.match(out, /Repeatedly interrupting others/);
    assert.match(out, /Host actions recorded for this person/);
    assert.match(out, /muted this person's microphone/);
  });

  it("combined report has an overview, every person's breakdown, and the full transcript", async () => {
    const out = text((await buildCombinedPdf(data))!);
    assert.match(out, /Combined performance report/);
    assert.match(out, /Overview/);
    for (const name of ["Kumar", "Meena", "Ravi"]) assert.match(out, new RegExp(name));
    assert.match(out, /Removed/);
    assert.match(out, /Group summary/);
    assert.match(out, /Full discussion transcript/);
    assert.match(out, /Ravi: I think everything should stay unregulated/);
    // Not the one-line-per-person stub that the earlier version produced.
    assert.ok(out.split("\n").length > 80);
  });

  it("transcript PDF: host sees everyone, a participant only their own", async () => {
    const host = text((await buildTranscriptPdf(data, {}))!);
    assert.match(host, /Kumar: Regulation/);
    assert.match(host, /Ravi: I think/);
    const mine = text((await buildTranscriptPdf(data, { participantId: "p1" }))!);
    assert.match(mine, /Small startups need clear/);
    assert.doesNotMatch(mine, /unregulated/);
  });

  it("handles a purged transcript and very long transcripts across pages", async () => {
    const purged = text((await buildIndividualPdf({ ...data, transcriptPurged: true }, "p1"))!);
    assert.match(purged, /deleted under this session's retention setting/);
    const long = { ...data, people: [person({ turns: Array.from({ length: 300 }, (_, i) => ({ offsetSec: i * 5, speaker: "Kumar", text: `Point number ${i} about regulation of creative tools and fair use.`, source: "live" })) })] };
    const out = text((await buildIndividualPdf(long, "p1"))!);
    assert.match(out, /Point number 299/);
    assert.match(out, /Page \d+ of \d+/);
  });

  it("has no blank pages: the page count in the footer matches the real page count", async () => {
    for (const buffer of [(await buildIndividualPdf(data, "p1"))!, (await buildCombinedPdf(data))!, (await buildTranscriptPdf(data, {}))!]) {
      const out = text(buffer);
      const pages = out.split("\f").filter((page) => page.trim().length > 0);
      const declared = Number(out.match(/Page 1 of (\d+)/)![1]);
      assert.equal(pages.length, declared);
      for (const page of pages) assert.ok(page.replace(/Quorum\s+·.*Page \d+ of \d+/, "").trim().length > 20, "a page holds only its footer");
    }
  });

  it("keeps the arithmetic honest and sanitises unsupported characters", () => {
    assert.equal(criteriaMath(criteria).total, 65.4);
    assert.equal(pdfSafe("Hello “world” — नमस्ते"), "Hello “world” — ??????");
  });
});
