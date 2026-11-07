import type { Relevance } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aiEnabled, complete, parseJson } from "@/server/ai";
import { noteSpeech } from "@/server/activity";
import { emitDiscussion } from "@/server/realtime";
import { classifyStatement, type Classification, type PriorLine, type RelevanceLabel, wordCount } from "@/server/scoring";

export type SegmentDTO = {
  id: string;
  participantId: string;
  userId: string;
  name: string;
  text: string;
  startedAt: string;
  endedAt: string;
  relevance: string;
  relevanceReason: string;
  analysisSource: string;
  newPerspective: boolean;
  repeatsPrior: boolean;
  hasEvidence: boolean;
  respondsToOthers: boolean;
  positiveContribution: boolean;
};

function toLabel(value: string): RelevanceLabel {
  if (value === "HIGHLY_RELEVANT" || value === "RELEVANT" || value === "PARTIALLY_RELEVANT" || value === "IRRELEVANT" || value === "PENDING") return value;
  return "PARTIALLY_RELEVANT";
}

export function segmentDTO(segment: {
  id: string;
  participantId: string;
  text: string;
  startedAt: Date;
  endedAt: Date;
  relevance: string;
  relevanceReason: string;
  analysisSource: string;
  newPerspective: boolean;
  repeatsPrior: boolean;
  hasEvidence: boolean;
  respondsToOthers: boolean;
  positiveContribution: boolean;
  participant: { userId: string; displayName: string };
}): SegmentDTO {
  return {
    id: segment.id,
    participantId: segment.participantId,
    userId: segment.participant.userId,
    name: segment.participant.displayName,
    text: segment.text,
    startedAt: segment.startedAt.toISOString(),
    endedAt: segment.endedAt.toISOString(),
    relevance: segment.relevance,
    relevanceReason: segment.relevanceReason,
    analysisSource: segment.analysisSource,
    newPerspective: segment.newPerspective,
    repeatsPrior: segment.repeatsPrior,
    hasEvidence: segment.hasEvidence,
    respondsToOthers: segment.respondsToOthers,
    positiveContribution: segment.positiveContribution,
  };
}

async function modelClassification(input: {
  topic: string;
  description: string;
  rules: string;
  text: string;
  previous: PriorLine[];
  lexical: Classification;
}): Promise<{ classification: Classification; source: "model" | "lexical" }> {
  if (!aiEnabled()) return { classification: input.lexical, source: "lexical" };
  const context = input.previous
    .slice(-12)
    .map((line) => `${line.speakerId ?? "speaker"} [${line.relevance ?? "unknown"}]: ${line.text}`)
    .join("\n");
  try {
    const raw = await complete(
      "You judge one turn in a group discussion. Keep the topic fixed. Use the recent transcript as context. Do not judge accent, gender, appearance, or personality. Return JSON only with keys relevance (HIGHLY_RELEVANT|RELEVANT|PARTIALLY_RELEVANT|IRRELEVANT), reason (one sentence), newPerspective, repeatsPrior, logicalArgument, hasEvidence, respondsToOthers, positiveContribution, communication, knowledge, reasoning. Scores are integers 0-100 based only on the words.",
      `Topic: ${input.topic}\nDescription: ${input.description}\nRules: ${input.rules}\nRecent transcript:\n${context || "(none)"}\n\nNew contribution:\n${input.text}`,
    );
    if (!raw) return { classification: input.lexical, source: "lexical" };
    const parsed = parseJson(raw);
    const relevance = toLabel(String(parsed.relevance ?? input.lexical.relevance));
    const num = (value: unknown, fallback: number) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
    };
    return {
      source: "model",
      classification: {
        relevance,
        reason: String(parsed.reason || input.lexical.reason).slice(0, 400),
        newPerspective: Boolean(parsed.newPerspective),
        repeatsPrior: Boolean(parsed.repeatsPrior),
        logicalArgument: Boolean(parsed.logicalArgument),
        hasEvidence: Boolean(parsed.hasEvidence),
        respondsToOthers: Boolean(parsed.respondsToOthers),
        positiveContribution: parsed.positiveContribution == null ? input.lexical.positiveContribution : Boolean(parsed.positiveContribution),
        communication: num(parsed.communication, input.lexical.communication),
        knowledge: num(parsed.knowledge, input.lexical.knowledge),
        reasoning: num(parsed.reasoning, input.lexical.reasoning),
        conceptHits: input.lexical.conceptHits,
      },
    };
  } catch (error) {
    console.error("Relevance model failed, using the lexical reading.", error);
    return { classification: input.lexical, source: "lexical" };
  }
}

export async function addSegment(input: { discussionId: string; userId: string; text: string; startedAt?: string; endedAt?: string }) {
  const text = input.text.replace(/\s+/g, " ").trim();
  const words = wordCount(text);
  if (words < 2 && !/^(yes|no|agree|disagree)$/i.test(text)) return null;
  if (text.length > 2000) return null;

  const discussion = await prisma.discussion.findUnique({
    where: { id: input.discussionId },
    include: { transcript: true },
  });
  if (!discussion || discussion.status === "COMPLETED" || discussion.status === "CANCELLED") return null;
  if (!discussion.transcriptionEnabled || discussion.transcriptsPurgedAt) return null;
  const participant = await prisma.discussionParticipant.findUnique({
    where: { discussionId_userId: { discussionId: discussion.id, userId: input.userId } },
  });
  if (!participant || participant.removed || !participant.transcriptionConsent) return null;

  const recent = await prisma.transcriptSegment.findMany({
    where: { discussionId: discussion.id },
    orderBy: { startedAt: "desc" },
    take: 12,
    include: { participant: true },
  });
  const duplicate = recent.find((segment) => segment.participantId === participant.id && segment.text.toLowerCase() === text.toLowerCase() && Date.now() - segment.createdAt.getTime() < 8000);
  if (duplicate) return segmentDTO(duplicate);

  const previous: PriorLine[] = recent
    .slice()
    .reverse()
    .map((segment) => ({
      text: segment.text,
      relevance: segment.relevance as RelevanceLabel,
      speakerId: segment.participant.userId,
      at: segment.startedAt.getTime(),
    }));
  const last = recent[0];
  const started = input.startedAt ? new Date(input.startedAt) : new Date();
  const ended = input.endedAt ? new Date(input.endedAt) : new Date();
  const lexical = classifyStatement({
    topic: discussion.topic,
    description: discussion.description,
    text,
    speakerId: input.userId,
    previous,
    secondsSincePrevious: last ? Math.max(0, (started.getTime() - last.startedAt.getTime()) / 1000) : null,
  });

  const transcriptId = discussion.transcript?.id;
  if (!transcriptId) return null;

  const created = await prisma.transcriptSegment.create({
    data: {
      transcriptId,
      discussionId: discussion.id,
      participantId: participant.id,
      text,
      startedAt: started,
      endedAt: ended,
      wordCount: words,
      relevance: "PENDING",
    },
    include: { participant: true },
  });
  await prisma.speakingStat.upsert({
    where: { participantId: participant.id },
    create: { participantId: participant.id, contributionCount: 1 },
    update: { contributionCount: { increment: 1 } },
  });
  noteSpeech(discussion.id, input.userId);
  emitDiscussion(discussion.id, "segment", segmentDTO(created));

  void finishAnalysis(created.id, {
    topic: discussion.topic,
    description: discussion.description,
    rules: discussion.rules,
    text,
    previous,
    lexical,
  });
  return segmentDTO(created);
}

async function finishAnalysis(segmentId: string, input: Parameters<typeof modelClassification>[0]) {
  const { classification, source } = await modelClassification(input);
  const updated = await prisma.transcriptSegment.update({
    where: { id: segmentId },
    data: {
      relevance: classification.relevance as Relevance,
      relevanceReason: classification.reason,
      analysisSource: source,
      newPerspective: classification.newPerspective,
      repeatsPrior: classification.repeatsPrior,
      logicalArgument: classification.logicalArgument,
      hasEvidence: classification.hasEvidence,
      respondsToOthers: classification.respondsToOthers,
      positiveContribution: classification.positiveContribution,
      communicationScore: classification.communication,
      knowledgeScore: classification.knowledge,
      reasoningScore: classification.reasoning,
    },
    include: { participant: true },
  });
  const stat = await prisma.speakingStat.findUnique({ where: { participantId: updated.participantId } });
  if (stat) {
    await prisma.speakingStat.update({
      where: { participantId: updated.participantId },
      data: {
        relevantCount: classification.relevance === "HIGHLY_RELEVANT" || classification.relevance === "RELEVANT" ? { increment: 1 } : undefined,
        partialCount: classification.relevance === "PARTIALLY_RELEVANT" ? { increment: 1 } : undefined,
        irrelevantCount: classification.relevance === "IRRELEVANT" ? { increment: 1 } : undefined,
        newIdeas: classification.newPerspective ? { increment: 1 } : undefined,
        constructiveResponses: classification.respondsToOthers && classification.positiveContribution ? { increment: 1 } : undefined,
      },
    });
  }
  emitDiscussion(updated.discussionId, "segment", segmentDTO(updated));
}
