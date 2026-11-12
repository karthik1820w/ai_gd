import type { Relevance } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aiEnabled, complete, parseJson } from "@/server/ai";
import { aliasPeople, aliasText, taskPrompt, UTTERANCE_SCHEMA, type Aliases } from "@/server/aiPrompts";
import { readBrief } from "@/server/brief";
import { noteSpeech } from "@/server/activity";
import { emitDiscussion, emitUser } from "@/server/realtime";
import { aiWeights, scoreAIPillars } from "@/server/aiScoring";
import { computeRubric, parseRubricWeights } from "@/server/rubric";
import { classifyStatement, scoreParticipant, type Classification, type PriorLine, type RelevanceLabel, wordCount } from "@/server/scoring";

const pendingByDiscussion = new Map<string, Set<Promise<void>>>();

export async function waitForPendingAnalysis(discussionId: string, timeoutMs: number) {
  const pending = pendingByDiscussion.get(discussionId);
  if (!pending?.size) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    void Promise.allSettled([...pending]).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

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
  accuracy: string;
  correction: string;
  understandingScore: number | null;
  originalityScore: number | null;
  concepts: string[];
  gist: string;
};

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
  accuracy: string;
  correction: string;
  understandingScore: number | null;
  originalityScore: number | null;
  concepts: string;
  gist: string;
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
    accuracy: segment.accuracy,
    correction: segment.correction,
    understandingScore: segment.understandingScore,
    originalityScore: segment.originalityScore,
    concepts: parseConcepts(segment.concepts),
    gist: segment.gist,
  };
}

function parseConcepts(value: string) {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 3) : [];
  } catch {
    return [];
  }
}

async function modelClassification(input: {
  topic: string;
  description: string;
  context: string;
  rules: string;
  text: string;
  previous: PriorLine[];
  lexical: Classification;
  aliases: Aliases;
  speakerId: string;
  brief: string;
  discussionId: string;
}): Promise<{
  classification: Classification;
  source: "gemini" | "heuristic";
  accuracy: string;
  correction: string;
  understanding: number | null;
  originality: number | null;
  concepts: string[];
  gist: string;
}> {
  const heuristic = {
    classification: input.lexical,
    source: "heuristic" as const,
    accuracy: "unverifiable",
    correction: "",
    understanding: null,
    originality: null,
    concepts: input.lexical.conceptHits.slice(0, 3),
    gist: "",
  };
  if (!aiEnabled()) return heuristic;
  const context = input.previous
    .slice(-12)
    .map((line) => `${input.aliases.byId.get(line.speakerId || "") ?? "speaker"} [${line.relevance ?? "unknown"}]: ${aliasText(line.text, input.aliases)}`)
    .join("\n");
  try {
    const raw = await complete(
      taskPrompt("UTTERANCE", "Analyze only this spoken contribution against the topic and compact briefing. Return JSON matching the provided schema. Accuracy must be accurate, partly_accurate, inaccurate, opinion, off_topic, or unverifiable. Only give a correction when clearly and confidently inaccurate, in at most 25 words. Understanding, reasoning, and originality are integers 1-5. Do not reward length, confidence, jargon, or flattery. Ignore likely speech-recognition errors. Keep the feedback descriptive, not punitive."),
      `Topic: ${aliasText(input.topic, input.aliases)}\nDescription: ${aliasText(input.description, input.aliases)}\n<context>${aliasText(input.context, input.aliases)}</context>\n<briefing>${aliasText(input.brief, input.aliases)}</briefing>\nRules: ${aliasText(input.rules, input.aliases)}\n<recent_transcript>\n${context || "(none)"}\n</recent_transcript>\n<utterance speaker="${input.aliases.byId.get(input.speakerId) ?? "speaker"}">${aliasText(input.text, input.aliases)}</utterance>`,
      { tier: "flash", responseSchema: UTTERANCE_SCHEMA, roomId: input.discussionId },
    );
    if (!raw) return heuristic;
    const parsed = parseJson(raw);
    const rawRelevance = Number(parsed.relevance);
    const relevanceScore = Number.isFinite(rawRelevance) ? Math.max(0, Math.min(1, rawRelevance)) : Number.NaN;
    const relevance = Number.isFinite(relevanceScore)
      ? relevanceScore >= 0.82 ? "HIGHLY_RELEVANT" : relevanceScore >= 0.58 ? "RELEVANT" : relevanceScore >= 0.3 ? "PARTIALLY_RELEVANT" : "IRRELEVANT"
      : input.lexical.relevance;
    const five = (value: unknown) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.max(1, Math.min(5, Math.round(number))) : null;
    };
    const num = (value: unknown, fallback: number) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : fallback;
    };
    const understanding = five(parsed.understanding);
    const reasoning = five(parsed.reasoning);
    const originality = five(parsed.originality);
    const accuracy = ["accurate", "partly_accurate", "inaccurate", "opinion", "off_topic", "unverifiable"].includes(String(parsed.accuracy))
      ? String(parsed.accuracy)
      : "unverifiable";
    const correction = accuracy === "inaccurate" && typeof parsed.correction === "string"
      ? parsed.correction.trim().split(/\s+/).slice(0, 25).join(" ").slice(0, 400)
      : "";
    const concepts = Array.isArray(parsed.concepts)
      ? parsed.concepts.filter((item): item is string => typeof item === "string").map((item) => item.trim().slice(0, 80)).filter(Boolean).slice(0, 3)
      : [];
    return {
      source: "gemini",
      accuracy,
      correction,
      understanding,
      originality,
      concepts,
      gist: typeof parsed.gist === "string" ? parsed.gist.trim().split(/\s+/).slice(0, 10).join(" ").slice(0, 300) : "",
      classification: {
        relevance,
        reason: `Gemini rated this ${accuracy.replaceAll("_", " ")} with ${Math.round(num(relevanceScore, 0) * 100)}% topic relevance.`,
        newPerspective: originality !== null ? originality >= 4 : input.lexical.newPerspective,
        repeatsPrior: input.lexical.repeatsPrior,
        logicalArgument: reasoning !== null ? reasoning >= 3 : input.lexical.logicalArgument,
        hasEvidence: input.lexical.hasEvidence,
        respondsToOthers: parsed.responds_to_others === true,
        positiveContribution: accuracy !== "off_topic" && accuracy !== "inaccurate" && input.lexical.positiveContribution,
        communication: input.lexical.communication,
        knowledge: understanding === null ? input.lexical.knowledge : num(understanding / 5 * 100, input.lexical.knowledge),
        reasoning: reasoning === null ? input.lexical.reasoning : num(reasoning / 5 * 100, input.lexical.reasoning),
        conceptHits: input.lexical.conceptHits,
      },
    };
  } catch (error) {
    console.error("Gemini utterance analysis failed; retaining heuristic analysis.", error);
    return heuristic;
  }
}

export async function addSegment(input: { discussionId: string; userId: string; text: string; startedAt?: string; endedAt?: string }) {
  const text = input.text.replace(/\s+/g, " ").trim();
  const words = wordCount(text);
  if (words < 2 && !/^(yes|no|agree|disagree)$/i.test(text)) return null;
  if (text.length > 2000) return null;

  const discussion = await prisma.discussion.findUnique({
    where: { id: input.discussionId },
    include: { transcript: true, participants: { select: { userId: true, displayName: true } } },
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
  const aliases = aliasPeople(discussion.participants.map((person) => ({ id: person.userId, name: person.displayName })));
  const brief = await readBrief(discussion.aiBrief);
  const compactBrief = brief?.status === "ready"
    ? JSON.stringify({
        summary: brief.summary,
        key_concepts: brief.key_concepts,
        key_facts: brief.key_facts,
        arguments_for: brief.arguments_for,
        arguments_against: brief.arguments_against,
      }).slice(0, 3000)
    : "";
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

  const pending = finishAnalysis(created.id, {
    topic: discussion.topic,
    description: discussion.description,
    context: discussion.context,
    rules: discussion.rules,
    text,
    previous,
    lexical,
    aliases,
    speakerId: input.userId,
    brief: compactBrief,
    discussionId: discussion.id,
  }).catch((error) => console.error("Could not save transcript analysis.", error));
  const roomPending = pendingByDiscussion.get(discussion.id) ?? new Set<Promise<void>>();
  roomPending.add(pending);
  pendingByDiscussion.set(discussion.id, roomPending);
  void pending.finally(() => {
    roomPending.delete(pending);
    if (!roomPending.size) pendingByDiscussion.delete(discussion.id);
  });
  return segmentDTO(created);
}

async function finishAnalysis(segmentId: string, input: Parameters<typeof modelClassification>[0]) {
  const result = await modelClassification(input);
  const { classification, source } = result;
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
      accuracy: source === "gemini" ? result.accuracy : "unverifiable",
      correction: result.correction,
      understandingScore: result.understanding === null ? null : result.understanding * 20,
      originalityScore: result.originality === null ? null : result.originality * 20,
      concepts: JSON.stringify(result.concepts),
      gist: result.gist,
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
  await publishLiveScores(updated.discussionId);
  if (source === "gemini" && result.accuracy === "inaccurate" && result.correction) {
    const note = {
      name: updated.participant.displayName,
      correction: result.correction,
      speakerId: updated.participant.userId,
    };
    emitUser(updated.participant.userId, "ai-note", note);
    const host = await prisma.discussion.findUnique({ where: { id: updated.discussionId }, select: { hostId: true } });
    if (host && host.hostId !== updated.participant.userId) emitUser(host.hostId, "ai-note", note);
  }
}

export async function publishLiveScores(discussionId: string) {
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
    include: {
      participants: { include: { stat: true } },
      segments: { orderBy: { startedAt: "asc" } },
      missed: true,
      technical: true,
    },
  });
  if (!discussion) return;
  const active = discussion.participants.filter((participant) => !participant.removed && participant.userId !== discussion.hostId);
  const totalSpeakingMs = active.reduce((sum, participant) => sum + (participant.stat?.speakingMs ?? 0), 0);
  const configuredWeights = aiWeights().weights;
  const rubricWeights = parseRubricWeights().weights;
  const rows = active.map((participant) => {
    const own = discussion.segments.filter((segment) => segment.participantId === participant.id && segment.relevance !== "PENDING");
    const missed = discussion.missed.filter((item) => item.participantId === participant.id);
    const technical = discussion.technical.filter((item) => item.participantId === participant.id);
    const speakingMs = participant.stat?.speakingMs ?? 0;
    const scored = scoreParticipant({
      contributions: own.map((segment) => ({
        wordCount: segment.wordCount,
        relevance: segment.relevance as RelevanceLabel,
        communication: segment.communicationScore ?? 50,
        knowledge: segment.knowledgeScore ?? 50,
        reasoning: segment.reasoningScore ?? 50,
        respondsToOthers: segment.respondsToOthers,
        positiveContribution: segment.positiveContribution,
      })),
      speakingMs,
      totalSpeakingMs: Math.max(totalSpeakingMs, speakingMs),
      participantCount: active.length,
      missed: {
        noResponse: missed.filter((item) => item.reason === "NO_RESPONSE").length,
        muted: missed.filter((item) => item.reason === "MUTED").length,
        technical: missed.filter((item) => item.reason === "TECHNICAL").length + technical.length,
        hostLocked: missed.filter((item) => item.reason === "HOST_LOCKED").length,
        disconnect: missed.filter((item) => item.reason === "DISCONNECT").length,
      },
      mediaReady: participant.mediaReady,
      speechAvailable: participant.speechAvailable,
      blockingTechnical: technical.some((item) => ["MIC_DENIED", "SPEECH_UNSUPPORTED", "ICE_FAILED"].includes(item.kind)),
    });
    const pillars = scoreAIPillars({
      contributions: own.map((segment) => ({
        understanding: segment.understandingScore ?? segment.knowledgeScore,
        reasoning: segment.reasoningScore,
        originality: segment.originalityScore ?? (segment.newPerspective ? 70 : 50),
        accuracy: segment.accuracy,
        relevance: segment.relevance,
        respondsToOthers: segment.respondsToOthers,
      })),
      participation: scored.participation,
      weights: configuredWeights,
    });
    const rubric = computeRubric({ scored, knowledge: pillars.knowledge, weights: rubricWeights });
    return {
      participantId: participant.id,
      userId: participant.userId,
      name: participant.displayName,
      knowledge: pillars.knowledge,
      participation: pillars.participation,
      thinking: pillars.thinking,
      overall: rubric.overall ?? pillars.overall,
      source: own.some((segment) => segment.analysisSource === "gemini") ? "gemini" : "heuristic",
    };
  });
  emitUser(discussion.hostId, "live-scores", { scores: rows });
  for (const row of rows) emitUser(row.userId, "my-live-score", { score: row });
}
