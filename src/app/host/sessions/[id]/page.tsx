import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth";
import { formatClock, formatWhen } from "@/lib/format";
import { CopyLine } from "@/components/JoinForm";
import { HostActions, HostFeedback } from "@/components/HostTools";
import { ScoreChart } from "@/components/ReportView";
import { readBrief } from "@/server/brief";
import { TranscriptBlock } from "@/components/TranscriptBlock";
import { AutoRefresh } from "@/components/AutoRefresh";
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

export default async function HostSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await readSession();
  if (!user) redirect("/login");
  const { id } = await params;
  const discussion = await prisma.discussion.findUnique({
    where: { id },
    include: {
      accessCodes: { where: { active: true }, take: 1 },
      participants: { include: { stat: true, evaluation: { include: { parameters: true, notes: true } }, user: true, moderation: { orderBy: { createdAt: "asc" } } } },
      summary: { include: { points: true } },
      recordings: true,
    },
  });
  if (!discussion || discussion.hostId !== user.id) notFound();
  const code = discussion.accessCodes[0]?.code ?? "";
  // Independent lookups run together, not one after the other.
  const [requestHeaders, transcript, brief] = await Promise.all([
    headers(),
    discussion.status === "COMPLETED" ? generateTranscript(discussion.id) : Promise.resolve(null),
    readBrief(discussion.aiBrief),
  ]);
  const forwardedHost = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const proto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim() || (forwardedHost?.startsWith("localhost") ? "http" : "https");
  const origin = (process.env.APP_URL?.trim() || (forwardedHost ? `${proto}://${forwardedHost}` : "http://localhost:3000")).replace(/\/+$/, "");
  const guests = discussion.participants.filter((person) => person.userId !== user.id);
  // Each person's transcript is worked out once (it used to be done twice per person on every load).
  const ownTranscript = new Map(guests.map((person) => [person.id, transcript ? filterBySpeaker(transcript, person.id) : null]));
  return (
    <>
      <p className="pill">{discussion.status}</p>
      <h1 className="serif" style={{ marginBottom: 4 }}>{discussion.title}</h1>
      <p className="muted">{discussion.topic}</p>
      <div className="card card-pad list" style={{ marginBottom: 16 }}>
        <CopyLine label="Meeting ID" value={discussion.meetingId} />
        <CopyLine label="Access code" value={code} />
        <CopyLine label="Shareable URL" value={`${origin}/meeting/${discussion.meetingId}?code=${code}`} />
        <HostActions id={discussion.id} status={discussion.status} meetingId={discussion.meetingId} />
      </div>
      {brief && brief.status !== "off" && <section className="card card-pad" style={{ marginBottom: 16 }}>
        <h2 className="serif">AI topic primer</h2>
        <p className="muted">Transcripts may be sent to Google Gemini for analysis and evaluation.</p>
        {brief.status === "pending" && <p className="muted">Preparing the briefing…</p>}
        {brief.status === "failed" && <p className="muted">Gemini briefing unavailable.</p>}
        {brief.status === "ready" && <>
          <p>{brief.summary}</p>
          {brief.key_concepts?.map((concept) => <p key={concept.term}><strong>{concept.term}</strong>: {concept.definition}</p>)}
          <details><summary>Host rubric and misconceptions</summary>
            {brief.rubric?.map((item, index) => <p key={`rubric-${index}`}>{item}</p>)}
            {brief.misconceptions?.map((item, index) => <p key={`misconception-${index}`}>Misconception: {item}</p>)}
          </details>
        </>}
      </section>}
      <section className="card card-pad" style={{ marginBottom: 16 }}>
        <h2 className="serif">People</h2>
        {guests.length === 0 && <p className="muted">Nobody else has joined. Share the code, or invite an email that already has an account.</p>}
        {guests.map((person) => (
          <p key={person.id}><strong>{person.displayName}</strong> <span className="muted">{person.user.email} · {formatClock(person.stat?.speakingMs ?? 0)} speaking · {person.stat?.contributionCount ?? 0} lines</span></p>
        ))}
      </section>
      {discussion.status === "COMPLETED" && guests.some((person) => !person.evaluation) && <section className="card card-pad" style={{ marginBottom: 16 }}><AutoRefresh /><p className="muted">Scores are being prepared. This page updates by itself.</p></section>}
      {discussion.status === "COMPLETED" && (
        <>
          <section className="card card-pad" style={{ marginBottom: 16 }}>
            <h2 className="serif">Session analytics</h2>
            <p>Engagement (share of on-topic lines): {discussion.summary?.engagementScore ?? 0}%</p>
            <p className="muted">{discussion.summary?.source === "gemini" ? "Group summary generated by Gemini." : "Group summary uses the heuristic fallback."}</p>
            {guests[0]?.evaluation?.parameters.length ? <p className="muted">Scoring weights: {guests[0].evaluation.parameters.map((parameter) => `${parameter.label} ${Math.round(parameter.weight * 100)}%`).join(" · ")}</p> : null}
            <ScoreChart rows={guests.flatMap((person) => person.evaluation?.overallScore == null ? [] : [{ name: person.displayName, score: person.evaluation.adjustedScore ?? person.evaluation.overallScore }])} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <a className="btn btn-ghost" href={`/api/discussions/${discussion.id}/pdf?type=SUMMARY`}>Summary PDF</a>
              <a className="btn btn-ghost" href={`/api/discussions/${discussion.id}/pdf?type=COMBINED&download=1`}>Full report (PDF): scores, how they were worked out, transcripts</a>
              <a className="btn btn-ghost" href={`/api/discussions/${discussion.id}/pdf?type=TRANSCRIPT`}>Full transcript (PDF)</a>
              {(["txt", "md", "srt", "json"] as const).map((format) => <a key={format} className="btn btn-ghost" href={`/api/discussions/${discussion.id}/transcript?format=${format}&download=1`}>Transcript .{format}</a>)}
              <a className="btn btn-ghost" href={`/host/sessions/${discussion.id}/preview`}>Preview a PDF</a>
            </div>
            {discussion.summary?.points.map((point) => <p key={point.id}><strong>{point.kind.toLowerCase()}: </strong>{point.body}</p>)}
          </section>
          {guests.map((person) => person.evaluation && (
            <section key={person.id} className="card card-pad" style={{ marginBottom: 12 }}>
              <h3>{person.displayName} · {person.evaluation.adjustedScore ?? person.evaluation.overallScore ?? "Incomplete"} · {person.evaluation.category}</h3>
              <p className="muted">{person.evaluation.source === "gemini" ? `Evaluated by Gemini${person.evaluation.model ? ` (${person.evaluation.model})` : ""}` : "Heuristic fallback used."}</p>
              {person.evaluation.sttIssue && <p role="status">Score may be incomplete because speech capture had a technical issue.</p>}
              {person.removed && <p className="error" role="note"><strong>Removed by you</strong>{person.removedAt ? ` at ${formatWhen(person.removedAt)}` : ""}. Reason: {person.removedReason || "Disruptive behaviour"}</p>}
              {person.moderation.filter((event) => event.kind !== "REMOVED").map((event) => <p key={event.id} className="muted" style={{ margin: "2px 0" }}>{formatWhen(event.createdAt)} · {moderationText(event.kind, event.detail)}</p>)}
              <p style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <a href={`/api/discussions/${discussion.id}/pdf?type=INDIVIDUAL&participantId=${person.id}&download=1`}>Download report (PDF)</a>
                <a href={`/api/discussions/${discussion.id}/pdf?type=TRANSCRIPT&participantId=${person.id}&download=1`}>Download transcript (PDF)</a>
              </p>
              {discussion.recordings.filter((recording) => recording.participantId === person.id).map((recording) => <p key={recording.id}><a href={`/api/recordings/${recording.id}`}>Microphone recording</a></p>)}
              {person.evaluation.parameters.map((parameter) => (
                <p key={parameter.id} style={{ margin: "4px 0" }}><strong>{parameter.label}</strong> ({Math.round(parameter.weight * 100)}%): {parameter.score == null ? "Not enough data" : parameter.score.toFixed(0)} · Confidence: {parameter.confidence == null ? "not available" : `${Math.round(parameter.confidence * 100)}%`} · Evidence: {parseEvidenceIds(parameter.evidenceIds).join(", ") || "none"}<br /><span className="muted">{parameter.explanation}</span></p>
              ))}
              {ownTranscript.get(person.id) && <details style={{ margin: "8px 0" }}>
                <summary>Transcript ({ownTranscript.get(person.id)!.totals.words} words)</summary>
                <TranscriptBlock turns={ownTranscript.get(person.id)!.turns} />
                <p><a href={`/api/discussions/${discussion.id}/transcript?format=txt&speaker=${person.id}&download=1`}>Download this person&apos;s transcript</a></p>
              </details>}
              <HostFeedback discussionId={discussion.id} evaluationId={person.evaluation.id} />
            </section>
          ))}
        </>
      )}
      <p className="muted">Scheduled {formatWhen(discussion.scheduledAt)} · {discussion.durationMin} minutes · {discussion.mode === "AI_MODERATED" ? "AI-moderated" : "Free-flow"}</p>
      <p><Link href="/host">Back to dashboard</Link></p>
    </>
  );
}
