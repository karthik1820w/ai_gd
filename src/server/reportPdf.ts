import PDFDocument from "pdfkit";
import { GRADE_BANDS } from "./scoring.ts";
import { clock } from "./transcript.ts";

/**
 * Report PDFs (pure: data in, bytes out; no database).
 *
 * A report answers three questions: what was the score, how was it worked out, and what was
 * it based on (the transcript). Everything a person needs is inside the file.
 */

const INK = "#1c1915";
const MUTED = "#5e584e";
const MOSS = "#0e6b52";
const LINE = "#e3ddd2";
const WARN = "#9a3b2e";
const W = 499; // content width on A4 with 48 pt margins

type Doc = InstanceType<typeof PDFDocument>;

export type ReportCriterion = { key: string; label: string; weight: number; score: number | null; explanation: string };
export type ReportTurn = { offsetSec: number; speaker: string; text: string; source: string };
export type ReportModeration = { kind: string; text: string; at: string };

export type ReportPerson = {
  participantId: string;
  name: string;
  /** The score shown: the host's adjusted score when there is one. */
  score: number | null;
  originalScore: number | null;
  adjusted: boolean;
  adjustmentReason: string | null;
  category: string;
  incomplete: boolean;
  incompleteReason: string | null;
  speakingMs: number;
  contributions: number;
  participationPercent: number;
  /** AI invitations this person did not answer (and were not excused from). */
  missedInvites?: number;
  source: string;
  model: string | null;
  criteria: ReportCriterion[];
  strengths: string[];
  improvements: string[];
  remark: string;
  covered: string[];
  missed: string[];
  moderation: ReportModeration[];
  removed: { at: string | null; reason: string } | null;
  turns: ReportTurn[];
};

export type ReportGroup = {
  source: string;
  conclusion: string;
  keyInsights: string[];
  agreements: string[];
  disagreements: string[];
  missedTopics: string[];
  bestContribution: string | null;
};

export type ReportData = {
  title: string;
  topic: string;
  when: string;
  durationMin: number;
  hostName: string;
  evaluatedBy: string;
  people: ReportPerson[];
  group: ReportGroup | null;
  /** Everyone's turns in time order (host reports only). */
  fullTranscript: ReportTurn[];
  transcriptPurged: boolean;
};

export type BuildOptions = { compress?: boolean };

/** A file name that is safe on every system, and different for each person so a host can keep them side by side. */
export function reportFilename(meetingId: string, type: string, personName?: string | null) {
  const slug = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40);
  const parts = ["quorum", slug(meetingId) || "discussion", type.toLowerCase()];
  const who = personName ? slug(personName) : "";
  if (who) parts.push(who);
  return `${parts.join("-")}.pdf`;
}

// ---------- text safety ----------
// The built-in PDF fonts cover Western European text. Anything else would print as garbage, so it becomes "?".
export function pdfSafe(text: string) {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/[^\u0009\u000a\u000d\u0020-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026\u20ac\u2122]/g, "?");
}

function collect(doc: Doc) {
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  return new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
}

function newDoc(options: BuildOptions) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 48, bottom: 64, left: 48, right: 48 }, bufferPages: true, compress: options.compress ?? true });
  return { doc, done: collect(doc) };
}

function footers(doc: Doc, label: string) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    // The footer sits inside the bottom margin; without this, pdfkit starts a new page to hold it.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(pdfSafe(`Quorum  ·  ${label}  ·  Page ${index + 1} of ${range.count}`), 48, 812, { width: W, align: "left", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
}

function banner(doc: Doc, title: string, subtitle: string) {
  doc.rect(0, 0, doc.page.width, 74).fill(MOSS);
  doc.fillColor("#f4f1ea").font("Helvetica-Bold").fontSize(18).text("Quorum", 48, 22, { lineBreak: false });
  doc.font("Helvetica").fontSize(10).text(pdfSafe(subtitle), 48, 46, { width: W, lineBreak: false });
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(20).text(pdfSafe(title), 48, 96, { width: W });
  doc.moveDown(0.4);
}

function room(doc: Doc, height: number) {
  if (doc.y + height > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function h2(doc: Doc, text: string) {
  room(doc, 60);
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(pdfSafe(text), 48, doc.y, { width: W });
  doc.moveDown(0.3);
}

function para(doc: Doc, text: string, options: { size?: number; color?: string; bold?: boolean; italic?: boolean } = {}) {
  const font = options.bold ? "Helvetica-Bold" : options.italic ? "Helvetica-Oblique" : "Helvetica";
  doc.font(font).fontSize(options.size ?? 10).fillColor(options.color ?? INK);
  room(doc, doc.heightOfString(pdfSafe(text), { width: W }) + 4);
  doc.text(pdfSafe(text), 48, doc.y, { width: W });
  doc.moveDown(0.25);
}

function bullets(doc: Doc, items: string[], color = INK) {
  for (const item of items) {
    doc.font("Helvetica").fontSize(10).fillColor(color);
    room(doc, doc.heightOfString(pdfSafe(item), { width: W - 14 }) + 4);
    const y = doc.y;
    doc.text("•", 52, y, { lineBreak: false });
    doc.text(pdfSafe(item), 64, y, { width: W - 16 });
    doc.moveDown(0.15);
  }
}

function kv(doc: Doc, rows: Array<[string, string]>) {
  for (const [label, value] of rows) {
    room(doc, 20);
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(label.toUpperCase(), 48, y + 1, { width: 105, lineBreak: false });
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(pdfSafe(value), 158, y, { width: W - 110 });
    doc.moveDown(0.2);
  }
}

function meter(doc: Doc, score: number | null, x: number, y: number, width: number) {
  doc.roundedRect(x, y, width, 6, 3).fill(LINE);
  if (score != null && score > 0) doc.roundedRect(x, y, Math.max(4, (width * Math.min(100, score)) / 100), 6, 3).fill(MOSS);
}

const pct = (weight: number) => `${Math.round(weight * 100)}%`;
const fmtScore = (score: number | null) => (score == null ? "–" : String(Math.round(score)));
const minutes = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

/** Weighted points per criterion, and their sum: this is the arithmetic behind the overall score. */
export function criteriaMath(criteria: ReportCriterion[]) {
  const rows = criteria.map((criterion) => ({ ...criterion, points: criterion.score == null ? 0 : criterion.score * criterion.weight }));
  const total = rows.reduce((sum, row) => sum + row.points, 0);
  return { rows, total: Math.round(total * 10) / 10 };
}

// ---------- sections ----------
function methodology(doc: Doc, data: ReportData) {
  h2(doc, "How the score is calculated");
  para(doc, "Each criterion is scored from 0 to 100 from what the person actually said, using their own microphone transcript. The overall score is the weighted total: for every criterion, multiply its score by its weight, then add them up.");
  para(doc, `Scored by: ${data.evaluatedBy}. Appearance, accent, gender and personality are not inputs. People who joined late or were muted by the host are not penalised for the time they could not speak.`, { color: MUTED, size: 9 });
  const bands = GRADE_BANDS.map((band, index) => `${band.label} ${band.min}-${index === 0 ? 100 : GRADE_BANDS[index - 1].min - 1}`).join("  ·  ");
  para(doc, `Grade bands: ${bands}. A report with no usable speech is marked Incomplete instead of being given a low score.`, { color: MUTED, size: 9 });
}

function criteriaTable(doc: Doc, person: ReportPerson) {
  const { rows, total } = criteriaMath(person.criteria);
  room(doc, 80);
  // Header
  let y = doc.y;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
  doc.text("CRITERION", 48, y, { width: 200, lineBreak: false });
  doc.text("WEIGHT", 300, y, { width: 50, align: "right", lineBreak: false });
  doc.text("SCORE", 355, y, { width: 50, align: "right", lineBreak: false });
  doc.text("POINTS", 410, y, { width: 50, align: "right", lineBreak: false });
  doc.moveTo(48, y + 12).lineTo(48 + W, y + 12).strokeColor(LINE).lineWidth(1).stroke();
  doc.y = y + 18;
  for (const row of rows) {
    doc.font("Helvetica").fontSize(9);
    const explanation = pdfSafe(row.explanation || "");
    const needed = 26 + (explanation ? doc.heightOfString(explanation, { width: W }) : 0) + 10;
    room(doc, needed);
    y = doc.y;
    doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text(pdfSafe(row.label), 48, y, { width: 245, lineBreak: false });
    doc.font("Helvetica").text(pct(row.weight), 300, y, { width: 50, align: "right", lineBreak: false });
    doc.font("Helvetica-Bold").text(fmtScore(row.score), 355, y, { width: 50, align: "right", lineBreak: false });
    doc.font("Helvetica").text(row.score == null ? "–" : row.points.toFixed(1), 410, y, { width: 50, align: "right", lineBreak: false });
    meter(doc, row.score, 48, y + 15, 245);
    doc.y = y + 26;
    if (explanation) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(explanation, 48, doc.y, { width: W });
    }
    doc.moveDown(0.5);
  }
  room(doc, 40);
  y = doc.y;
  doc.moveTo(48, y).lineTo(48 + W, y).strokeColor(LINE).lineWidth(1).stroke();
  doc.font("Helvetica-Bold").fontSize(10).fillColor(INK).text("Overall (sum of points)", 48, y + 6, { width: 245, lineBreak: false });
  doc.text(person.incomplete ? "Incomplete" : total.toFixed(1), 410, y + 6, { width: 50, align: "right", lineBreak: false });
  doc.y = y + 24;
  if (person.adjusted) para(doc, `The host set the final score to ${fmtScore(person.score)} (calculated score ${fmtScore(person.originalScore)}). Reason: ${person.adjustmentReason || "not given"}.`, { color: WARN, size: 9 });
}

function transcriptSection(doc: Doc, turns: ReportTurn[], options: { speakers: boolean; heading: string; note: string; purged?: boolean }) {
  h2(doc, options.heading);
  para(doc, options.note, { color: MUTED, size: 9 });
  if (options.purged) { para(doc, "The transcript was deleted under this session's retention setting."); return; }
  if (!turns.length) { para(doc, "No speech was captured."); return; }
  for (const turn of turns) {
    const label = `[${clock(turn.offsetSec)}] ${options.speakers ? `${turn.speaker}: ` : ""}`;
    const text = pdfSafe(`${turn.text}${turn.source !== "live" ? " (from recording)" : ""}`);
    doc.font("Helvetica").fontSize(10);
    const height = doc.heightOfString(`${pdfSafe(label)}${text}`, { width: W - 4 });
    room(doc, height + 6);
    const y = doc.y;
    doc.font("Helvetica-Bold").fillColor(MOSS).text(pdfSafe(label), 48, y, { width: W, continued: true });
    doc.font("Helvetica").fillColor(INK).text(text, { width: W });
    doc.moveDown(0.25);
  }
}

function personSection(doc: Doc, person: ReportPerson, options: { speakersInTranscript: boolean; purged: boolean }) {
  // Name, score, status
  room(doc, 150);
  const top = doc.y;
  doc.font("Helvetica-Bold").fontSize(26).fillColor(person.incomplete ? MUTED : MOSS).text(person.incomplete ? "—" : fmtScore(person.score), 48, top, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(INK).text(pdfSafe(person.name), 120, top + 2, { width: W - 72, lineBreak: false });
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(pdfSafe(`out of 100  ·  ${person.adjusted ? "Host-adjusted" : person.category}${person.removed ? "  ·  Removed by the host" : ""}`), 120, top + 20, { width: W - 72, lineBreak: false });
  doc.y = top + 46;

  kv(doc, [
    ["Participation basis", `${person.contributions} ${person.contributions === 1 ? "turn" : "turns"}  ·  ${minutes(person.speakingMs)} speaking  ·  ${person.participationPercent}% of the group's speech${person.missedInvites ? `  ·  ${person.missedInvites} AI ${person.missedInvites === 1 ? "invitation" : "invitations"} not answered` : ""}`],
    ["Scored by", person.source === "gemini" ? `Gemini${person.model ? ` (${person.model})` : ""}` : "Built-in heuristic scoring (no AI model was available)"],
  ]);

  if (person.incompleteReason) para(doc, `Why this report is incomplete: ${person.incompleteReason}`, { color: WARN });

  if (person.removed || person.moderation.length) {
    h2(doc, "Host actions recorded for this person");
    if (person.removed) para(doc, `Removed from the discussion${person.removed.at ? ` at ${person.removed.at}` : ""}. Reason given: ${person.removed.reason}.`, { color: WARN, bold: true });
    bullets(doc, person.moderation.filter((event) => event.kind !== "REMOVED").map((event) => `${event.at}  ${event.text}`));
    para(doc, "Scores below reflect only what this person said before and while these actions applied.", { color: MUTED, size: 9 });
  }

  h2(doc, "Score breakdown");
  criteriaTable(doc, person);

  if (person.strengths.length || person.improvements.length || person.remark) {
    h2(doc, "Feedback");
    if (person.remark) para(doc, person.remark);
    if (person.strengths.length) { para(doc, "Strengths", { bold: true }); bullets(doc, person.strengths); }
    if (person.improvements.length) { para(doc, "To improve", { bold: true }); bullets(doc, person.improvements); }
    if (person.covered.length) para(doc, `Concepts covered: ${person.covered.join(", ")}`, { color: MUTED, size: 9 });
    if (person.missed.length) para(doc, `Concepts to explore: ${person.missed.join(", ")}`, { color: MUTED, size: 9 });
  }

  transcriptSection(doc, person.turns, {
    speakers: options.speakersInTranscript,
    heading: "Transcript (what this score is based on)",
    note: `${person.turns.reduce((sum, turn) => sum + turn.text.split(/\s+/).filter(Boolean).length, 0)} words in ${person.turns.length} turns, in time order. Times are from the start of the discussion.`,
    purged: options.purged,
  });
}

// ---------- reports ----------
export async function buildIndividualPdf(data: ReportData, participantId: string, options: BuildOptions = {}) {
  const person = data.people.find((item) => item.participantId === participantId);
  if (!person) return null;
  const { doc, done } = newDoc(options);
  banner(doc, "Individual performance report", `${data.title}  ·  ${data.when}`);
  kv(doc, [["Topic", data.topic], ["Session", data.title], ["When", data.when], ["Duration", `${data.durationMin} min scheduled`], ["Participant", person.name]]);
  doc.moveDown(0.4);
  personSection(doc, person, { speakersInTranscript: false, purged: data.transcriptPurged });
  methodology(doc, data);
  footers(doc, `${person.name} · Individual report`);
  doc.end();
  return done;
}

export async function buildCombinedPdf(data: ReportData, options: BuildOptions = {}) {
  const { doc, done } = newDoc(options);
  banner(doc, "Combined performance report", `${data.title}  ·  ${data.when}`);
  kv(doc, [["Topic", data.topic], ["Session", data.title], ["When", data.when], ["Duration", `${data.durationMin} min scheduled`], ["Host", data.hostName], ["Participants", String(data.people.length)]]);

  h2(doc, "Overview");
  if (!data.people.length) para(doc, "Nobody other than the host took part, so there is nothing to score.");
  const ranked = [...data.people].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  let y = doc.y;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
  doc.text("#", 48, y, { width: 18, lineBreak: false });
  doc.text("PARTICIPANT", 68, y, { width: 150, lineBreak: false });
  doc.text("SCORE", 225, y, { width: 40, align: "right", lineBreak: false });
  doc.text("GRADE", 280, y, { width: 80, lineBreak: false });
  doc.text("SPEAKING", 360, y, { width: 55, align: "right", lineBreak: false });
  doc.text("TURNS", 420, y, { width: 40, align: "right", lineBreak: false });
  doc.text("NOTES", 468, y, { width: 80, lineBreak: false });
  doc.moveTo(48, y + 12).lineTo(48 + W, y + 12).strokeColor(LINE).stroke();
  doc.y = y + 18;
  ranked.forEach((person, index) => {
    room(doc, 22);
    y = doc.y;
    doc.font("Helvetica").fontSize(10).fillColor(INK);
    doc.text(String(index + 1), 48, y, { width: 18, lineBreak: false });
    doc.font("Helvetica-Bold").text(pdfSafe(person.name), 68, y, { width: 150, lineBreak: false });
    doc.text(person.incomplete ? "–" : fmtScore(person.score), 225, y, { width: 40, align: "right", lineBreak: false });
    doc.font("Helvetica").text(person.adjusted ? "Host-adjusted" : person.category, 280, y, { width: 80, lineBreak: false });
    doc.text(minutes(person.speakingMs), 360, y, { width: 55, align: "right", lineBreak: false });
    doc.text(String(person.contributions), 420, y, { width: 40, align: "right", lineBreak: false });
    doc.fillColor(person.removed ? WARN : MUTED).fontSize(8).text(person.removed ? "Removed" : person.incomplete ? "No speech" : "", 468, y + 1, { width: 80, lineBreak: false });
    doc.y = y + 20;
  });

  if (data.group) {
    h2(doc, "Group summary");
    if (data.group.conclusion) para(doc, data.group.conclusion);
    const lists: Array<[string, string[]]> = [["Key insights", data.group.keyInsights], ["Agreed on", data.group.agreements], ["Disagreed on", data.group.disagreements], ["Missed topics", data.group.missedTopics]];
    for (const [label, items] of lists) if (items.length) { para(doc, label, { bold: true }); bullets(doc, items); }
    if (data.group.bestContribution) para(doc, `Best contribution: ${data.group.bestContribution}`, { color: MUTED, size: 9 });
  }
  methodology(doc, data);

  for (const person of ranked) {
    doc.addPage();
    personSection(doc, person, { speakersInTranscript: false, purged: data.transcriptPurged });
  }

  doc.addPage();
  transcriptSection(doc, data.fullTranscript, {
    speakers: true,
    heading: "Full discussion transcript",
    note: "Everyone who took part, in time order. The host is not transcribed. Only the host can see this page.",
    purged: data.transcriptPurged,
  });
  footers(doc, "Combined report");
  doc.end();
  return done;
}

export async function buildTranscriptPdf(data: ReportData, scope: { participantId?: string }, options: BuildOptions = {}) {
  const { doc, done } = newDoc(options);
  const own = scope.participantId ? data.people.find((item) => item.participantId === scope.participantId) : null;
  banner(doc, own ? "My transcript" : "Transcript", `${data.title}  ·  ${data.when}`);
  kv(doc, [["Topic", data.topic], ["Session", data.title], ["When", data.when]]);
  transcriptSection(doc, own ? own.turns : data.fullTranscript, {
    speakers: !own,
    heading: own ? `${own.name}` : "Everyone who took part",
    note: own ? "Only you and the host can see this." : "The host is not transcribed.",
    purged: data.transcriptPurged,
  });
  footers(doc, own ? "My transcript" : "Transcript");
  doc.end();
  return done;
}
