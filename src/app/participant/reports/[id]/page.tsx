import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth";
import { formatClock, formatWhen } from "@/lib/format";
import { ScoreChart } from "@/components/ReportView";
import { TranscriptBlock } from "@/components/TranscriptBlock";
import { filterBySpeaker } from "@/server/transcript";
import { generateTranscript } from "@/server/transcriptStore";
import { moderationText } from "@/server/moderationText";

export const dynamic = "force-dynamic";

function parseEvidenceIds(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export default async function ParticipantReport({ params }: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) redirect("/login");
  const { id } = await params;
  const participant = await prisma.discussionParticipant.findUnique({
    where: { discussionId_userId: { discussionId: id, userId: user.id } },
    include: { discussion: true, evaluation: { include: { parameters: true, notes: true } }, stat: true, moderation: { orderBy: { createdAt: "asc" } } },
  });
  if (!participant) notFound();
  const evaluation = participant.evaluation;
  const shown = evaluation?.adjustedScore ?? evaluation?.overallScore;
  const full = evaluation ? await generateTranscript(id) : null;
  const mine = full ? filterBySpeaker(full, participant.id) : null;
  return (
    <>
      <p className="pill">{participant.discussion.topic}</p>
      <h1 className="serif">{participant.displayName}</h1>
      <p className="muted">{formatWhen(participant.discussion.startedAt ?? participant.discussion.scheduledAt)} · scheduled {participant.discussion.durationMin} min · ID {participant.id}</p>
      {participant.removed && (
        <div className="card card-pad" style={{ borderColor: "#a3463f", marginBottom: 12 }} role="note">
          <strong>You were removed from this discussion by the host.</strong>
          <p style={{ margin: "4px 0 0" }}>{participant.removedAt ? `At ${formatWhen(participant.removedAt)}. ` : ""}Reason: {participant.removedReason || "Disruptive behaviour"}.</p>
        </div>
      )}
      {participant.moderation.filter((event) => event.kind !== "REMOVED").length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 12 }}>
          <strong>Host actions during the discussion</strong>
          {participant.moderation.filter((event) => event.kind !== "REMOVED").map((event) => <p key={event.id} className="muted" style={{ margin: "2px 0" }}>{formatWhen(event.createdAt)} · {moderationText(event.kind, event.detail)}</p>)}
        </div>
      )}
      {!evaluation && <p>The host has not finished this discussion yet, so there is no score.</p>}
      {evaluation && (
        <div className="card card-pad">
          <p className="serif" style={{ fontSize: 56, margin: 0 }}>{shown == null ? "—" : shown.toFixed(0)}</p>
          <p>{evaluation.adjustedScore != null ? "Host-adjusted score" : evaluation.category} · {evaluation.participationPercent}% of the group's speech · {formatClock(evaluation.speakingMs)} speaking · {evaluation.contributionCount} contributions</p>
          <p className="muted">{evaluation.source === "gemini" ? `Evaluated by Gemini${evaluation.model ? ` (${evaluation.model})` : ""}` : "Evaluated with the heuristic fallback."}</p>
          <p className="muted">Weights: {evaluation.parameters.map((parameter) => `${parameter.label} ${Math.round(parameter.weight * 100)}%`).join(" · ")}</p>
          {evaluation.incompleteReason && <p>{evaluation.incompleteReason}</p>}
          {evaluation.sttIssue && <p role="status">Score may be incomplete because speech capture had a technical issue.</p>}
          {evaluation.adjustedScore != null && <p>Original score {evaluation.overallScore ?? "—"}. Host note: {evaluation.adjustmentReason}</p>}
          <ScoreChart rows={evaluation.parameters.flatMap((parameter) => parameter.score == null ? [] : [{ name: parameter.label, score: parameter.score }])} />
          {evaluation.parameters.map((parameter) => (
            <p key={parameter.id}><strong>{parameter.label}</strong> ({Math.round(parameter.weight * 100)}%): {parameter.score == null ? "Not enough data" : parameter.score.toFixed(0)} · Confidence: {parameter.confidence == null ? "not available" : `${Math.round(parameter.confidence * 100)}%`} · Evidence: {parameter.evidenceIds ? parseEvidenceIds(parameter.evidenceIds).join(", ") || "none" : "not recorded"}<br /><span className="muted">{parameter.explanation}</span></p>
          ))}
          {mine && <>
            <h2 className="serif">Your transcript</h2>
            <p className="muted">What was captured from you, and what your scores were based on. {mine.totals.words} words in {mine.totals.turns} turns.</p>
            <TranscriptBlock turns={mine.turns} />
          </>}
          <h2 className="serif">How your score was worked out</h2>
          <p className="muted">Each criterion is scored 0 to 100 from your own transcript. The overall score is the weighted total: score × weight, added up. The explanations above say what raised or lowered each one.</p>
          <h2 className="serif">Feedback</h2>
          {evaluation.notes.map((note) => <p key={note.id}><strong>{note.kind.toLowerCase()}: </strong>{note.body}</p>)}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn btn-primary" href={`/api/discussions/${id}/pdf?type=INDIVIDUAL&download=1`}>Download my report (PDF)</a>
            <a className="btn btn-ghost" href={`/api/discussions/${id}/feedback`}>Download my feedback (.txt)</a>
            <a className="btn btn-ghost" href={`/api/discussions/${id}/pdf?type=INDIVIDUAL`}>Preview PDF</a>
            <a className="btn btn-ghost" href={`/api/discussions/${id}/pdf?type=TRANSCRIPT&download=1`}>Download my transcript (PDF)</a>
          </div>
        </div>
      )}
      <p><Link href="/participant">Back</Link></p>
    </>
  );
}
