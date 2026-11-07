import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { safeEqual } from "@/server/ids";

const discussionPublic = {
  id: true,
  hostId: true,
  title: true,
  topic: true,
  description: true,
  rules: true,
  scheduledAt: true,
  durationMin: true,
  speakingTimeSec: true,
  maxParticipants: true,
  mode: true,
  moderatorEnabled: true,
  transcriptionEnabled: true,
  recordingEnabled: true,
  silencePromptSec: true,
  meetingId: true,
  status: true,
  startedAt: true,
  endedAt: true,
} satisfies Prisma.DiscussionSelect;

export async function activeCode(discussionId: string) {
  return prisma.accessCode.findFirst({ where: { discussionId, active: true }, orderBy: { createdAt: "desc" } });
}

export async function findDiscussionByMeeting(meetingId: string) {
  return prisma.discussion.findUnique({
    where: { meetingId },
    include: { accessCodes: { where: { active: true }, take: 1 } },
  });
}

export async function memberOf(discussionId: string, userId: string) {
  return prisma.discussionParticipant.findUnique({ where: { discussionId_userId: { discussionId, userId } } });
}

export async function canAccess(input: { meetingId: string; userId: string; role: string; code?: string | null }) {
  const discussion = await findDiscussionByMeeting(input.meetingId);
  if (!discussion || discussion.status === "CANCELLED") return null;
  const membership = await memberOf(discussion.id, input.userId);
  const isHost = discussion.hostId === input.userId;
  if (membership?.removed) return null;
  const code = discussion.accessCodes[0]?.code ?? "";
  const codeOk = Boolean(input.code && code && safeEqual(code, input.code));
  if (!isHost && !membership && !codeOk) return null;
  const seated = await seatsTaken(discussion.id, discussion.hostId);
  if (!isHost && !membership && seated >= discussion.maxParticipants) return { error: "This discussion is full." as const };
  return { discussion, membership, isHost, code };
}

export async function seatsTaken(discussionId: string, hostId: string) {
  return prisma.discussionParticipant.count({ where: { discussionId, removed: false, userId: { not: hostId } } });
}

export async function loadReadableDiscussion(id: string, userId: string) {
  const discussion = await prisma.discussion.findUnique({
    where: { id },
    include: {
      accessCodes: { where: { active: true }, take: 1 },
      participants: { include: { user: true, stat: true, evaluation: true } },
      summary: { include: { points: { orderBy: { sortOrder: "asc" } } } },
      evaluations: { include: { parameters: true, notes: true, participant: true } },
    },
  });
  if (!discussion) return null;
  const membership = discussion.participants.find((item) => item.userId === userId) ?? null;
  const isHost = discussion.hostId === userId;
  if (!isHost && (!membership || membership.removed)) return null;
  return { discussion, membership, isHost };
}

export { discussionPublic };
