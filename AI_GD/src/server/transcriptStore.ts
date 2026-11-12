import { prisma } from "@/lib/db";
import { buildTranscript, type TranscriptDoc } from "@/server/transcript";

/** Load a discussion's captured speech and generate the merged, speaker-labelled transcript. */
export async function generateTranscript(discussionId: string): Promise<TranscriptDoc | null> {
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
    include: { segments: { orderBy: { startedAt: "asc" }, include: { participant: true } } },
  });
  if (!discussion) return null;
  return buildTranscript({
    title: discussion.title,
    topic: discussion.topic,
    startedAt: discussion.startedAt ?? discussion.scheduledAt,
    segments: discussion.segments.map((segment) => ({
      id: segment.id,
      participantId: segment.participantId,
      name: segment.participant.displayName,
      text: segment.text,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      source: segment.source,
    })),
  });
}
