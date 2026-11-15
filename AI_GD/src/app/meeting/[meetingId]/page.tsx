import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { readSession } from "@/lib/auth";
import { MeetingApp } from "@/components/MeetingApp";
import { aiEnabled } from "@/server/ai";
import { readBrief } from "@/server/brief";

export const dynamic = "force-dynamic";

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ meetingId: string }>; searchParams: Promise<{ code?: string }> }) {
  const user = await readSession();
  const { meetingId } = await params;
  const { code } = await searchParams;
  if (!user) redirect(`/login?next=${encodeURIComponent(`/meeting/${meetingId}${code ? `?code=${code}` : ""}`)}`);
  const discussion = await prisma.discussion.findUnique({ where: { meetingId }, include: { accessCodes: { where: { active: true }, take: 1 }, participants: true } });
  if (!discussion || discussion.status === "CANCELLED") notFound();
  const removedRow = discussion.participants.find((person) => person.userId === user.id && person.removed);
  if (removedRow && discussion.hostId !== user.id) {
    return (
      <main className="content" style={{ maxWidth: 640, margin: "0 auto", paddingTop: 48 }}>
        <h1 className="serif">You were removed from this discussion</h1>
        <p>The host removed you{removedRow.removedAt ? ` at ${new Intl.DateTimeFormat("en-IN", { timeStyle: "short" }).format(removedRow.removedAt)}` : ""}.</p>
        <p><strong>Reason:</strong> {removedRow.removedReason || "Disruptive behaviour"}</p>
        <p className="muted">You cannot rejoin this discussion. The removal is recorded in your report.</p>
        <p><Link className="btn btn-primary" href={`/participant/reports/${discussion.id}`}>View my report</Link> <Link className="btn btn-ghost" href="/participant">Back to my discussions</Link></p>
      </main>
    );
  }
  const membership = discussion.participants.find((person) => person.userId === user.id && !person.removed);
  const isHost = discussion.hostId === user.id;
  const active = discussion.accessCodes[0]?.code;
  const { safeEqual } = await import("@/server/ids");
  if (!isHost && !membership && !(code && active && safeEqual(code, active))) {
    return <main className="content"><h1 className="serif">This meeting link or access code is not valid.</h1></main>;
  }
  const fullBrief = await readBrief(discussion.aiBrief);
  const brief = fullBrief && isHost ? fullBrief : fullBrief && { ...fullBrief, rubric: undefined, misconceptions: undefined };
  return (
    <MeetingApp
      code={code}
      user={{ id: user.id, name: user.name, speechLang: user.speechLang }}
      discussion={{
        id: discussion.id,
        meetingId: discussion.meetingId,
        title: discussion.title,
        topic: discussion.topic,
        description: discussion.description,
        rules: discussion.rules,
        mode: discussion.mode,
        status: discussion.status,
        durationMin: discussion.durationMin,
        speakingTimeSec: discussion.speakingTimeSec,
        moderatorEnabled: discussion.moderatorEnabled,
        transcriptionEnabled: discussion.transcriptionEnabled,
        recordingEnabled: discussion.recordingEnabled,
        aiEnabled: aiEnabled(),
        brief,
        isHost,
        roomCode: isHost ? active : undefined,
        displayName: membership?.displayName || user.name,
      }}
    />
  );
}
