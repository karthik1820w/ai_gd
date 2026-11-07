import { prisma } from "@/lib/db";
import { markLive } from "@/server/activity";
import { notifyDiscussion } from "@/server/notify";
import { emitDiscussion } from "@/server/realtime";

export async function startDiscussion(discussionId: string) {
  const discussion = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!discussion || discussion.status === "CANCELLED" || discussion.status === "COMPLETED") return null;
  if (discussion.status === "LIVE") return discussion;
  const updated = await prisma.discussion.update({
    where: { id: discussionId },
    data: { status: "LIVE", startedAt: new Date() },
  });
  markLive(discussionId);
  emitDiscussion(discussionId, "session-live", { startedAt: updated.startedAt?.toISOString() ?? null });
  await notifyDiscussion(discussionId, {
    type: "STARTED",
    title: "Discussion is live",
    body: `${updated.title} has started.`,
    href: `/meeting/${updated.meetingId}`,
  });
  return updated;
}
