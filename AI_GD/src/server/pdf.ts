import PDFDocument from "pdfkit";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { buildTranscript } from "@/server/transcript";
import { moderationText } from "@/server/moderationText";
import { buildCombinedPdf, buildIndividualPdf, buildTranscriptPdf, type ReportData, type ReportPerson } from "@/server/reportPdf";

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

function ensure(doc: Doc, y: number, needed = 80) {
  if (y + needed < 780) return y;
  doc.addPage();
  return 56;
}

const reportInclude = {
  host: true,
  participants: { include: { user: true, stat: true, moderation: { orderBy: { createdAt: "asc" } } } },
  evaluations: { include: { parameters: true, notes: true, participant: true } },
  summary: { include: { points: { orderBy: { sortOrder: "asc" } } } },
  segments: { orderBy: { startedAt: "asc" }, include: { participant: true } },
} satisfies Prisma.DiscussionInclude;
type LoadedDiscussion = Prisma.DiscussionGetPayload<{ include: typeof reportInclude }>;

export async function renderReport(input: { discussionId: string; type: string; participantId?: string; requesterId: string }) {
  const discussion = await prisma.discussion.findUnique({ where: { id: input.discussionId }, include: reportInclude });
  if (!discussion) return { error: "Report not found.", status: 404 as const };
  const isHost = discussion.hostId === input.requesterId;
  const mine = discussion.participants.find((participant) => participant.userId === input.requesterId);
  if (!isHost && !mine) return { error: "You cannot open this report.", status: 403 as const };
  if (!isHost && (input.type === "COMBINED" || input.type === "SUMMARY")) {
    return { error: "Participants can download their own report and their own transcript.", status: 403 as const };
  }
  if (!isHost && input.type === "INDIVIDUAL" && input.participantId && input.participantId !== mine?.id) {
    return { error: "You can download only your own report.", status: 403 as const };
  }
  const when = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(discussion.startedAt ?? discussion.scheduledAt);
  const slug = discussion.meetingId;
  const finish = (buffer: Buffer, participantId: string | null) => ({ buffer, filename: `quorum-${slug}-${input.type.toLowerCase()}.pdf`, type: input.type, discussionId: discussion.id, participantId });

  if (input.type === "SUMMARY") {
    const doc = new PDFDocument({ size: "A4", margin: 48, bufferPages: true });
    const done = collect(doc);
    drawSummary(doc, discussion as unknown as ReportDiscussion, when);
    footer(doc);
    doc.end();
    return finish(await done, null);
  }

  const data = assembleReport(discussion, when);
  const targetId = input.participantId || mine?.id;
  if (input.type === "INDIVIDUAL") {
    if (!targetId) return { error: "That participant does not have a report yet.", status: 404 as const };
    const buffer = await buildIndividualPdf(data, targetId);
    if (!buffer) return { error: "That participant does not have a report yet.", status: 404 as const };
    return finish(buffer, targetId);
  }
  if (input.type === "COMBINED") return finish(await buildCombinedPdf(data), null);
  if (discussion.transcriptsPurgedAt) return { error: "The transcript was deleted under this session's retention setting.", status: 410 as const };
  // A participant's transcript contains only their own lines.
  const scope = isHost ? (input.participantId ? { participantId: input.participantId } : {}) : { participantId: mine!.id };
  return finish(await buildTranscriptPdf(data, scope), scope.participantId ?? null);
}

const COVERED = "Concept covered: ";
const MISSED = "Concept to explore: ";
const BOILERPLATE = /^(Scores use each person|Moderation: |Accuracy note: )/;

/** Turn the saved discussion into the plain data the report builder needs. The host is never included. */
export function assembleReport(discussion: LoadedDiscussion, when: string): ReportData {
  const guests = discussion.participants.filter((person) => person.userId !== discussion.hostId);
  const guestIds = new Set(guests.map((person) => person.id));
  const full = discussion.transcriptsPurgedAt
    ? null
    : buildTranscript({
        title: discussion.title,
        topic: discussion.topic,
        startedAt: discussion.startedAt ?? discussion.scheduledAt,
        segments: discussion.segments
          .filter((segment) => guestIds.has(segment.participantId))
          .map((segment) => ({ id: segment.id, participantId: segment.participantId, name: segment.participant.displayName, text: segment.text, startedAt: segment.startedAt, endedAt: segment.endedAt, source: segment.source })),
      });
  const turnsOf = (turns: typeof full extends null ? never : NonNullable<typeof full>["turns"]) => turns.map((turn) => ({ offsetSec: turn.offsetSec, speaker: turn.speaker, text: turn.text, source: turn.source }));
  const first = discussion.evaluations[0];
  const people: ReportPerson[] = [];
  for (const person of guests) {
    const evaluation = discussion.evaluations.find((item) => item.participantId === person.id);
    if (!evaluation) continue;
    const notes = (kind: string) => evaluation.notes.filter((note) => note.kind === kind).map((note) => note.body);
    const remarks = notes("REMARK");
    const events = person.moderation.map((event) => ({ kind: event.kind, at: new Intl.DateTimeFormat("en-IN", { timeStyle: "short" }).format(event.createdAt), text: moderationText(event.kind, event.detail) }));
    people.push({
      participantId: person.id,
      name: person.displayName,
      score: evaluation.adjustedScore ?? evaluation.overallScore,
      originalScore: evaluation.overallScore,
      adjusted: evaluation.adjustedScore != null,
      adjustmentReason: evaluation.adjustmentReason,
      category: evaluation.category,
      incomplete: evaluation.incomplete,
      incompleteReason: evaluation.incompleteReason,
      speakingMs: evaluation.speakingMs,
      contributions: evaluation.contributionCount,
      participationPercent: evaluation.participationPercent,
      source: evaluation.source,
      model: evaluation.model,
      criteria: evaluation.parameters.map((parameter) => ({ key: parameter.key, label: parameter.label, weight: parameter.weight, score: parameter.score, explanation: parameter.explanation })),
      strengths: notes("STRENGTH"),
      improvements: notes("IMPROVEMENT"),
      remark: remarks.find((text) => !text.startsWith(COVERED) && !text.startsWith(MISSED) && !BOILERPLATE.test(text)) ?? "",
      covered: remarks.filter((text) => text.startsWith(COVERED)).map((text) => text.slice(COVERED.length)),
      missed: remarks.filter((text) => text.startsWith(MISSED)).map((text) => text.slice(MISSED.length)),
      moderation: events,
      removed: person.removed ? { at: person.removedAt ? new Intl.DateTimeFormat("en-IN", { timeStyle: "short" }).format(person.removedAt) : null, reason: person.removedReason || "Disruptive behaviour" } : null,
      turns: full ? turnsOf(full.turns.filter((turn) => turn.speakerId === person.id)) : [],
    });
  }
  const points = discussion.summary?.points ?? [];
  const ordered = (kind: string) => points.filter((point) => point.kind === kind).map((point) => point.body);
  return {
    title: discussion.title,
    topic: discussion.topic,
    when,
    durationMin: discussion.durationMin,
    hostName: discussion.host.name,
    evaluatedBy: first?.source === "gemini" ? `Gemini${first.model ? ` (${first.model})` : ""}` : "the built-in scoring",
    people,
    group: discussion.summary
      ? { source: discussion.summary.source, conclusion: ordered("CONCLUSION")[0] ?? "", keyInsights: ordered("IDEA"), agreements: ordered("AGREEMENT"), disagreements: ordered("DISAGREEMENT"), missedTopics: ordered("MISSED_TOPIC"), bestContribution: ordered("BEST_CONTRIBUTION")[0] ?? null }
      : null,
    fullTranscript: full ? turnsOf(full.turns) : [],
    transcriptPurged: Boolean(discussion.transcriptsPurgedAt),
  };
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
