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
  // Notifications are a courtesy; starting must not wait for one row per participant.
  void notifyDiscussion(discussionId, {
    type: "STARTED",
    title: "Discussion is live",
    body: `${updated.title} has started.`,
    href: `/meeting/${updated.meetingId}`,
  }).catch((error) => console.error("Could not send start notifications.", error));
  return updated;
}
