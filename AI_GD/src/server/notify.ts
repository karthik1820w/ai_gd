import { prisma } from "@/lib/db";
import { emitDiscussion, emitUser } from "@/server/realtime";

export async function notify(input: {
  userId: string;
  discussionId?: string;
  type: string;
  title: string;
  body: string;
  href?: string;
}) {
  const row = await prisma.notification.create({
    data: {
      userId: input.userId,
      discussionId: input.discussionId,
      type: input.type,
      title: input.title,
      body: input.body,
      href: input.href ?? "",
    },
  });
  emitUser(input.userId, "notification", {
    id: row.id,
    title: row.title,
    body: row.body,
    href: row.href,
    createdAt: row.createdAt.toISOString(),
  });
  return row;
}

export async function notifyDiscussion(discussionId: string, input: { type: string; title: string; body: string; href?: string }, includeHost = true) {
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
    include: { participants: true },
  });
  if (!discussion) return;
  const userIds = new Set<string>();
  if (includeHost) userIds.add(discussion.hostId);
  for (const participant of discussion.participants) {
    if (!participant.removed) userIds.add(participant.userId);
  }
  await Promise.all([...userIds].map((userId) => notify({ userId, discussionId, ...input })));
}

export { emitDiscussion };
