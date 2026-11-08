import PDFDocument from "pdfkit";
import { prisma } from "@/lib/db";

const INK = "#1c1915";
const MUTED = "#5e584e";
const MOSS = "#0e6b52";
const LINE = "#e3ddd2";

type Doc = InstanceType<typeof PDFDocument>;

function collect(doc: Doc) {
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  return done;
}

function footer(doc: Doc) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(`Quorum  ·  Page ${index + 1}`, 48, 810, { width: 500, align: "left", lineBreak: false });
  }
}

function heading(doc: Doc, title: string, subtitle: string) {
  doc.rect(0, 0, doc.page.width, 74).fill(MOSS);
  doc.fillColor("#f4f1ea").font("Helvetica-Bold").fontSize(18).text("Quorum", 48, 22, { lineBreak: false });
  doc.font("Helvetica").fontSize(10).text(subtitle, 48, 46, { width: 500 });
  doc.fillColor(INK);
  doc.font("Helvetica-Bold").fontSize(20).text(title, 48, 96, { width: 500 });
  return 132;
}

function bar(doc: Doc, label: string, score: number | null, y: number) {
  doc.font("Helvetica").fontSize(10).fillColor(INK).text(`${label}   ${score == null ? "Not scored" : `${score.toFixed(0)} / 100`}`, 48, y, { width: 500 });
  doc.roundedRect(48, y + 16, 400, 8, 4).fill(LINE);
  if (score != null) doc.roundedRect(48, y + 16, Math.max(4, (400 * score) / 100), 8, 4).fill(MOSS);
  return y + 36;
}

function ensure(doc: Doc, y: number, needed = 80) {
  if (y + needed < 780) return y;
  doc.addPage();
  return 56;
}

export async function renderReport(input: { discussionId: string; type: string; participantId?: string; requesterId: string }) {
  const discussion = await prisma.discussion.findUnique({
    where: { id: input.discussionId },
    include: {
      host: true,
      participants: { include: { user: true, stat: true } },
      evaluations: { include: { parameters: true, notes: true, participant: true } },
      summary: { include: { points: { orderBy: { sortOrder: "asc" } } } },
      segments: { orderBy: { startedAt: "asc" }, include: { participant: true } },
    },
  });
  if (!discussion) return { error: "Report not found.", status: 404 as const };
  const isHost = discussion.hostId === input.requesterId;
  const mine = discussion.participants.find((participant) => participant.userId === input.requesterId);
  if (!isHost && !mine) return { error: "You cannot open this report.", status: 403 as const };
  if (!isHost && (input.type === "COMBINED" || input.type === "SUMMARY")) {
    return { error: "Participants can download their own report and the shared transcript.", status: 403 as const };
  }
  if (!isHost && input.type === "INDIVIDUAL" && input.participantId && input.participantId !== mine?.id) {
    return { error: "You can download only your own report.", status: 403 as const };
  }
  if (discussion.transcriptsPurgedAt && input.type === "TRANSCRIPT") {
    return { error: "The transcript was deleted under this session's retention setting.", status: 410 as const };
  }

  const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
  const done = collect(doc);
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(discussion.startedAt ?? discussion.scheduledAt);

  if (input.type === "INDIVIDUAL") {
    const evaluation = discussion.evaluations.find((item) => item.participantId === (input.participantId || mine?.id));
    if (!evaluation) {
      doc.end();
      return { error: "That participant does not have a report yet.", status: 404 as const };
    }
    drawIndividual(doc, discussion as unknown as ReportDiscussion, evaluation as unknown as ReportDiscussion["evaluations"][number], when);
  } else if (input.type === "COMBINED") {
    drawCombined(doc, discussion as unknown as ReportDiscussion, when);
  } else if (input.type === "SUMMARY") {
    drawSummary(doc, discussion as unknown as ReportDiscussion, when);
  } else {
    drawTranscript(doc, discussion as unknown as ReportDiscussion, when);
  }
  footer(doc);
  doc.end();
  const buffer = await done;
  const slug = discussion.meetingId;
  return { buffer, filename: `quorum-${slug}-${input.type.toLowerCase()}.pdf`, type: input.type, discussionId: discussion.id, participantId: input.participantId ?? mine?.id ?? null };
}

function drawIndividual(doc: Doc, discussion: ReportDiscussion, evaluation: ReportDiscussion["evaluations"][number], when: string) {
  let y = heading(doc, evaluation.participant.displayName, "Individual performance report");
  y = meta(doc, y, [
    ["Topic", discussion.topic],
    ["Session", discussion.title],
    ["When", when],
    ["Duration", `${discussion.durationMin} min scheduled`],
    ["Participant ID", evaluation.participantId],
  ]);
  const shown = evaluation.adjustedScore ?? evaluation.overallScore;
  doc.font("Helvetica-Bold").fontSize(28).fillColor(MOSS).text(shown == null ? "—" : shown.toFixed(0), 48, y);
  doc.font("Helvetica").fontSize(12).fillColor(INK).text(`/ 100   ·   ${evaluation.adjustedScore != null ? "Host-adjusted" : evaluation.category}`, 110, y + 10);
  y += 42;
  if (evaluation.incompleteReason) {
    doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(evaluation.incompleteReason, 48, y, { width: 500 });
    y += 36;
  }
  doc.font("Helvetica").fontSize(11).fillColor(INK).text(`Speaking time ${Math.round(evaluation.speakingMs / 1000)}s   ·   ${evaluation.contributionCount} contributions   ·   ${evaluation.participationPercent}% of group speech`, 48, y, { width: 500 });
  y += 28;
  doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(
    `${evaluation.source === "gemini" ? `Evaluated by Gemini${evaluation.model ? ` (${evaluation.model})` : ""}` : "Heuristic fallback"}  ·  Weights: ${evaluation.parameters.map((item) => `${item.label} ${Math.round(item.weight * 100)}%`).join(", ")}`,
    48,
    y,
    { width: 500 },
  );
  y = doc.y + 12;
  doc.font("Helvetica-Bold").fontSize(13).text("Detailed evaluation", 48, y);
  y += 22;
  for (const parameter of evaluation.parameters) y = bar(doc, `${parameter.label} (${Math.round(parameter.weight * 100)}%)`, parameter.score, y);
  y = ensure(doc, y, 140);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text("AI feedback", 48, y);
  y += 20;
  for (const note of evaluation.notes) {
    y = ensure(doc, y, 40);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(MOSS).text(note.kind[0] + note.kind.slice(1).toLowerCase(), 48, y);
    y += 14;
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(note.body, 48, y, { width: 500 });
    y = doc.y + 8;
  }
  if (evaluation.adjustedScore != null) {
    y = ensure(doc, y, 70);
    doc.font("Helvetica-Bold").fontSize(12).text("Host correction", 48, y);
    doc.font("Helvetica").fontSize(10).text(`Score set to ${evaluation.adjustedScore.toFixed(0)}. Original score ${evaluation.overallScore ?? "—"}. Reason: ${evaluation.adjustmentReason}`, 48, y + 18, { width: 500 });
  }
}

function meta(doc: Doc, y: number, rows: Array<[string, string]>) {
  for (const [label, value] of rows) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(MUTED).text(label.toUpperCase(), 48, y, { continued: false });
    doc.font("Helvetica").fontSize(11).fillColor(INK).text(value, 160, y, { width: 380 });
    y += 18;
  }
  return y + 10;
}

function drawCombined(doc: Doc, discussion: ReportDiscussion, when: string) {
  let y = heading(doc, "Combined performance", discussion.topic);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(`${discussion.title}  ·  ${when}`, 48, y);
  y += 28;
  for (const evaluation of discussion.evaluations) {
    y = ensure(doc, y, 36);
    const score = evaluation.adjustedScore ?? evaluation.overallScore;
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(evaluation.participant.displayName, 48, y, { continued: true });
    doc.font("Helvetica").text(`    ${score == null ? "Incomplete" : score.toFixed(0)}   ${evaluation.category}   ${evaluation.contributionCount} contributions`, { continued: false });
    y += 22;
  }
}

function drawSummary(doc: Doc, discussion: ReportDiscussion, when: string) {
  let y = heading(doc, "Discussion summary", discussion.topic);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(`${discussion.title}  ·  ${when}  ·  Source: ${discussion.summary?.source ?? "not generated"}`, 48, y, { width: 500 });
  y += 28;
  const groups = ["ARGUMENT", "IDEA", "PERSPECTIVE", "AGREEMENT", "DISAGREEMENT", "CONCLUSION"];
  for (const kind of groups) {
    const points = discussion.summary?.points.filter((point) => point.kind === kind) ?? [];
    if (!points.length) continue;
    y = ensure(doc, y, 40);
    doc.font("Helvetica-Bold").fontSize(13).fillColor(INK).text(kind[0] + kind.slice(1).toLowerCase(), 48, y);
    y += 18;
    for (const point of points) {
      y = ensure(doc, y, 36);
      doc.font("Helvetica").fontSize(10).text(`•  ${point.body}`, 48, y, { width: 500 });
      y = doc.y + 6;
    }
    y += 8;
  }
  const names = new Map(discussion.participants.map((participant) => [participant.id, participant.displayName]));
  y = ensure(doc, y, 60);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(`Most active: ${names.get(discussion.summary?.mostActiveParticipantId ?? "") ?? "—"}. Least active: ${names.get(discussion.summary?.leastActiveParticipantId ?? "") ?? "—"}. On-topic share: ${discussion.summary?.engagementScore ?? 0}%.`, 48, y, { width: 500 });
}

function drawTranscript(doc: Doc, discussion: ReportDiscussion, when: string) {
  let y = heading(doc, "Transcript", discussion.topic);
  doc.font("Helvetica").fontSize(10).fillColor(MUTED).text(`${discussion.title}  ·  ${when}`, 48, y);
  y += 24;
  if (!discussion.segments.length) {
    doc.font("Helvetica").fontSize(11).fillColor(INK).text("No speech was captured.", 48, y);
    return;
  }
  for (const segment of discussion.segments) {
    y = ensure(doc, y, 48);
    const clock = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" }).format(segment.startedAt);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(MOSS).text(`${segment.participant.displayName}   ${clock}   ${segment.relevance.replaceAll("_", " ").toLowerCase()}`, 48, y, { width: 500 });
    y += 14;
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(segment.text, 48, y, { width: 500 });
    y = doc.y + 4;
    if (segment.relevanceReason) {
      doc.font("Helvetica-Oblique").fontSize(8).fillColor(MUTED).text(segment.relevanceReason, 48, y, { width: 500 });
      y = doc.y + 8;
    }
  }
}

type ReportDiscussion = {
  host: { name: string };
  participants: Array<{ id: string; displayName: string; userId: string }>;
  evaluations: Array<{
    participantId: string;
    overallScore: number | null;
    adjustedScore: number | null;
    category: string;
    speakingMs: number;
    contributionCount: number;
    participationPercent: number;
    incompleteReason: string | null;
    adjustmentReason: string | null;
    source: string;
    model: string | null;
    participant: { displayName: string };
    parameters: Array<{ label: string; weight: number; score: number | null }>;
    notes: Array<{ kind: string; body: string }>;
  }>;
  summary: { source: string; engagementScore: number | null; mostActiveParticipantId: string | null; leastActiveParticipantId: string | null; points: Array<{ kind: string; body: string }> } | null;
  segments: Array<{ text: string; relevance: string; relevanceReason: string; startedAt: Date; participant: { displayName: string } }>;
  title: string;
  topic: string;
  meetingId: string;
  durationMin: number;
  startedAt: Date | null;
  scheduledAt: Date;
  transcriptsPurgedAt: Date | null;
};
