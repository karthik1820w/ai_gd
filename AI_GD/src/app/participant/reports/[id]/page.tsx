import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth";
import { formatClock, formatWhen } from "@/lib/format";
import { ScoreChart } from "@/components/ReportView";

export const dynamic = "force-dynamic";

export default async function ParticipantReport({ params }: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) redirect("/login");
  const { id } = await params;
  const participant = await prisma.discussionParticipant.findUnique({
    where: { discussionId_userId: { discussionId: id, userId: user.id } },
    include: { discussion: true, evaluation: { include: { parameters: true, notes: true } }, stat: true },
  });
  if (!participant) notFound();
  const evaluation = participant.evaluation;
  const shown = evaluation?.adjustedScore ?? evaluation?.overallScore;
  return (
    <>
      <p className="pill">{participant.discussion.topic}</p>
      <h1 className="serif">{participant.displayName}</h1>
      <p className="muted">{formatWhen(participant.discussion.startedAt ?? participant.discussion.scheduledAt)} · scheduled {participant.discussion.durationMin} min · ID {participant.id}</p>
      {!evaluation && <p>The host has not finished this discussion yet, so there is no score.</p>}
      {evaluation && (
        <div className="card card-pad">
          <p className="serif" style={{ fontSize: 56, margin: 0 }}>{shown == null ? "—" : shown.toFixed(0)}</p>
          <p>{evaluation.adjustedScore != null ? "Host-adjusted score" : evaluation.category} · {evaluation.participationPercent}% of the group's speech · {formatClock(evaluation.speakingMs)} speaking · {evaluation.contributionCount} contributions</p>
          <p className="muted">{evaluation.source === "gemini" ? `Evaluated by Gemini${evaluation.model ? ` (${evaluation.model})` : ""}` : "Evaluated with the heuristic fallback."}</p>
          <p className="muted">Weights: {evaluation.parameters.map((parameter) => `${parameter.label} ${Math.round(parameter.weight * 100)}%`).join(" · ")}</p>
          {evaluation.incompleteReason && <p>{evaluation.incompleteReason}</p>}
          {evaluation.adjustedScore != null && <p>Original score {evaluation.overallScore ?? "—"}. Host note: {evaluation.adjustmentReason}</p>}
          <ScoreChart rows={evaluation.parameters.map((parameter) => ({ name: parameter.label, score: parameter.score ?? 0 }))} />
          {evaluation.parameters.map((parameter) => (
            <p key={parameter.id}><strong>{parameter.label}</strong> ({Math.round(parameter.weight * 100)}%): {parameter.score == null ? "Not scored" : parameter.score.toFixed(0)}<br /><span className="muted">{parameter.explanation}</span></p>
          ))}
          <h2 className="serif">Feedback</h2>
          {evaluation.notes.map((note) => <p key={note.id}><strong>{note.kind.toLowerCase()}: </strong>{note.body}</p>)}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a className="btn btn-primary" href={`/api/discussions/${id}/pdf?type=INDIVIDUAL&download=1`}>Download PDF</a>
            <a className="btn btn-ghost" href={`/api/discussions/${id}/feedback`}>Download my feedback (.txt)</a>
            <a className="btn btn-ghost" href={`/api/discussions/${id}/pdf?type=INDIVIDUAL`}>Preview PDF</a>
            <a className="btn btn-ghost" href={`/api/discussions/${id}/pdf?type=TRANSCRIPT`}>Shared transcript</a>
          </div>
        </div>
      )}
      <p><Link href="/participant">Back</Link></p>
    </>
  );
}
