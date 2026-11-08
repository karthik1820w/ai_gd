import { prisma } from "@/lib/db";
import { fail, guardOrigin, json, readBody } from "@/lib/http";
import { requireUser } from "@/lib/guard";
import { discussionSchema } from "@/lib/validators";
import { aiEnabled } from "@/server/ai";
import { generateBrief } from "@/server/brief";
import { newAccessCode, newMeetingId } from "@/server/ids";

export async function POST(request: Request) {
  const blocked = guardOrigin(request);
  if (blocked) return blocked;
  const { user, error } = await requireUser("HOST");
  if (!user) return error;
  const parsed = discussionSchema.safeParse(await readBody(request));
  if (!parsed.success) return fail("Check the discussion details. A room can hold up to 40 participants.");
  const scheduledAt = new Date(`${parsed.data.date}T${parsed.data.time}`);
  if (Number.isNaN(scheduledAt.getTime())) return fail("Enter a valid date and start time.");
  let meetingId = newMeetingId();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const clash = await prisma.discussion.findUnique({ where: { meetingId } });
    if (!clash) break;
    meetingId = newMeetingId();
  }
  const discussion = await prisma.discussion.create({
    data: {
      hostId: user.id,
      title: parsed.data.title,
      topic: parsed.data.topic,
      description: parsed.data.description,
      context: parsed.data.context,
      rules: parsed.data.rules,
      scheduledAt,
      durationMin: parsed.data.durationMin,
      speakingTimeSec: parsed.data.speakingTimeSec,
      maxParticipants: parsed.data.maxParticipants,
      mode: parsed.data.mode,
      moderatorEnabled: parsed.data.moderatorEnabled,
      transcriptionEnabled: parsed.data.transcriptionEnabled,
      recordingEnabled: parsed.data.recordingEnabled,
      silencePromptSec: parsed.data.silencePromptSec,
      retentionDays: parsed.data.retentionDays ?? null,
      meetingId,
      aiBrief: JSON.stringify({ status: aiEnabled() ? "pending" : "off" }),
      transcript: { create: {} },
      accessCodes: { create: { code: newAccessCode() } },
    },
    include: { accessCodes: true },
  });
  await prisma.notification.create({
    data: {
      userId: user.id,
      discussionId: discussion.id,
      type: "INVITE",
      title: "Discussion created",
      body: `${discussion.title} is ready to share.`,
      href: `/host/sessions/${discussion.id}`,
    },
  });
  if (aiEnabled()) {
    void generateBrief(discussion.id).catch((error) => console.error("Background topic briefing failed.", error));
  }
  return json({ id: discussion.id, meetingId: discussion.meetingId, code: discussion.accessCodes[0]?.code });
}
