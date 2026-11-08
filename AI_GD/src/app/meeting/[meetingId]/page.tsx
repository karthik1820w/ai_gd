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
        displayName: membership?.displayName || user.name,
      }}
    />
  );
}
