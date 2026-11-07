import { NoteKind, ReportType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aiEnabled, complete, parseJson } from "@/server/ai";
import { dropRoom, snapshot } from "@/server/activity";
import { finalizeJournal } from "@/server/journal";
import { notify } from "@/server/notify";
import { emitDiscussion } from "@/server/realtime";
import { FORMULA_VERSION, WEIGHTS, buildFeedback, classifyStatement, scoreParticipant, type PriorLine, type RelevanceLabel } from "@/server/scoring";

async function summarise(discussion: {
  id: string;
  topic: string;
  description: string;
  segments: Array<{ text: string; relevance: string; participant: { displayName: string }; newPerspective: boolean }>;
}) {
  const usable = discussion.segments.filter((segment) => segment.relevance !== "IRRELEVANT" && segment.relevance !== "PENDING");
  const fallback = {
    source: "extractive",
    arguments: usable.slice(0, 5).map((segment) => `${segment.participant.displayName}: ${segment.text}`),
    ideas: discussion.segments.filter((segment) => segment.newPerspective).slice(0, 5).map((segment) => segment.text),
    perspectives: [...new Map(usable.map((segment) => [segment.participant.displayName, segment.text])).entries()].map(([name, text]) => `${name}: ${text}`),
    agreements: usable.filter((segment) => /\b(i agree|shared|support)\b/i.test(segment.text)).map((segment) => segment.text).slice(0, 4),
    disagreements: usable.filter((segment) => /\b(however|disagree|but)\b/i.test(segment.text)).map((segment) => segment.text).slice(0, 4),
    conclusion: usable.length
      ? `The group produced ${usable.length} on-topic contributions about ${discussion.topic}.`
      : `The captured discussion did not produce enough on-topic speech to summarise ${discussion.topic}.`,
  };
  if (!aiEnabled() || discussion.segments.length === 0) return fallback;
  try {
    const transcript = discussion.segments.slice(-80).map((segment) => `${segment.participant.displayName}: ${segment.text}`).join("\n");
    const raw = await complete(
      "Summarise a group discussion using only the transcript. Do not invent remarks. Return JSON with arrays mainArguments, ideas, perspectives, agreements, disagreements, and a string conclusion. Each array has at most 5 short strings.",
      `Topic: ${discussion.topic}\nDescription: ${discussion.description}\nTranscript:\n${transcript.slice(0, 12000)}`,
    );
    if (!raw) return fallback;
    const parsed = parseJson(raw);
    const list = (value: unknown, fallbackList: string[]) => (Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean).slice(0, 5) : fallbackList);
    return {
      source: "model",
      arguments: list(parsed.mainArguments, fallback.arguments),
      ideas: list(parsed.ideas, fallback.ideas),
      perspectives: list(parsed.perspectives, fallback.perspectives),
      agreements: list(parsed.agreements, fallback.agreements),
      disagreements: list(parsed.disagreements, fallback.disagreements),
      conclusion: typeof parsed.conclusion === "string" && parsed.conclusion.trim() ? parsed.conclusion.trim() : fallback.conclusion,
    };
  } catch (error) {
    console.error("Summary model failed, using extractive summary.", error);
    return fallback;
  }
}

export async function evaluateDiscussion(discussionId: string) {
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
    include: {
      participants: { include: { stat: true, user: true } },
      segments: { orderBy: { startedAt: "asc" }, include: { participant: true } },
      missed: true,
      technical: true,
    },
  });
  if (!discussion) return null;
  for (const segment of discussion.segments) {
    if (segment.relevance !== "PENDING") continue;
    const previous: PriorLine[] = discussion.segments
      .filter((item) => item.startedAt < segment.startedAt)
      .slice(-12)
      .map((item) => ({ text: item.text, relevance: item.relevance as RelevanceLabel, speakerId: item.participant.userId }));
    const lexical = classifyStatement({
      topic: discussion.topic,
      description: discussion.description,
      text: segment.text,
      speakerId: segment.participant.userId,
      previous,
    });
    segment.relevance = lexical.relevance;
    segment.relevanceReason = lexical.reason;
    segment.analysisSource = segment.analysisSource === "pending" ? "lexical" : segment.analysisSource;
    segment.newPerspective = lexical.newPerspective;
    segment.repeatsPrior = lexical.repeatsPrior;
    segment.logicalArgument = lexical.logicalArgument;
    segment.hasEvidence = lexical.hasEvidence;
    segment.respondsToOthers = lexical.respondsToOthers;
    segment.positiveContribution = lexical.positiveContribution;
    segment.communicationScore = lexical.communication;
    segment.knowledgeScore = lexical.knowledge;
    segment.reasoningScore = lexical.reasoning;
    await prisma.transcriptSegment.update({
      where: { id: segment.id },
      data: {
        relevance: lexical.relevance,
        relevanceReason: lexical.reason,
        analysisSource: "lexical",
        newPerspective: lexical.newPerspective,
        repeatsPrior: lexical.repeatsPrior,
        logicalArgument: lexical.logicalArgument,
        hasEvidence: lexical.hasEvidence,
        respondsToOthers: lexical.respondsToOthers,
        positiveContribution: lexical.positiveContribution,
        communicationScore: lexical.communication,
        knowledgeScore: lexical.knowledge,
        reasoningScore: lexical.reasoning,
      },
    });
  }
  const active = discussion.participants.filter((participant) => !participant.removed && participant.userId !== discussion.hostId);
  const segmentSpeaking = new Map<string, number>();
  for (const segment of discussion.segments) {
    const duration = Math.max(0, segment.endedAt.getTime() - segment.startedAt.getTime());
    segmentSpeaking.set(segment.participantId, (segmentSpeaking.get(segment.participantId) ?? 0) + Math.min(duration, 60_000));
  }

  const previousAdjustments = await prisma.evaluation.findMany({ where: { discussionId } });
  const adjustments = new Map(previousAdjustments.map((item) => [item.participantId, item]));
  await prisma.evaluation.deleteMany({ where: { discussionId } });

  let mostId: string | null = null;
  let leastId: string | null = null;
  let mostMs = -1;
  let leastMs = Number.POSITIVE_INFINITY;

  for (const participant of active) {
    const own = discussion.segments.filter((segment) => segment.participantId === participant.id && segment.relevance !== "PENDING");
    const missed = discussion.missed.filter((item) => item.participantId === participant.id);
    const technical = discussion.technical.filter((item) => item.participantId === participant.id);
    const speakingMs = Math.max(participant.stat?.speakingMs ?? 0, segmentSpeaking.get(participant.id) ?? 0);
    const totalSpeaking = active.reduce((sum, person) => sum + Math.max(person.stat?.speakingMs ?? 0, segmentSpeaking.get(person.id) ?? 0), 0);
    if (speakingMs > mostMs) {
      mostMs = speakingMs;
      mostId = participant.id;
    }
    if (speakingMs < leastMs) {
      leastMs = speakingMs;
      leastId = participant.id;
    }
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
      totalSpeakingMs: Math.max(totalSpeaking, speakingMs),
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
      blockingTechnical: technical.some((item) => item.kind === "MIC_DENIED" || item.kind === "SPEECH_UNSUPPORTED" || item.kind === "ICE_FAILED"),
    });
    const feedback = buildFeedback({
      topic: discussion.topic,
      score: scored,
      quotes: {
        relevant: own.filter((segment) => segment.relevance === "HIGHLY_RELEVANT" || segment.relevance === "RELEVANT").map((segment) => segment.text),
        evidence: own.filter((segment) => segment.hasEvidence).map((segment) => segment.text),
        response: own.filter((segment) => segment.respondsToOthers).map((segment) => segment.text),
      },
      counts: {
        irrelevant: own.filter((segment) => segment.relevance === "IRRELEVANT").length,
        repeats: own.filter((segment) => segment.repeatsPrior).length,
        missed: missed.filter((item) => item.reason === "NO_RESPONSE").length,
        mutedIgnored: missed.some((item) => item.reason === "MUTED") && scored.explanations.participation.includes("not penalised"),
      },
    });
    const kept = adjustments.get(participant.id);
    const parameters = [
      ["topic_relevance", "Topic relevance", WEIGHTS.topicRelevance, scored.topicRelevance, scored.explanations.topicRelevance],
      ["communication", "Communication and clarity", WEIGHTS.communication, scored.communication, scored.explanations.communication],
      ["knowledge", "Knowledge and content quality", WEIGHTS.knowledge, scored.knowledge, scored.explanations.knowledge],
      ["participation", "Participation and initiative", WEIGHTS.participation, scored.participation, scored.explanations.participation],
      ["reasoning", "Logical reasoning", WEIGHTS.reasoning, scored.reasoning, scored.explanations.reasoning],
      ["listening", "Listening and constructive engagement", WEIGHTS.listening, scored.listening, scored.explanations.listening],
    ] as const;
    await prisma.evaluation.create({
      data: {
        discussionId,
        participantId: participant.id,
        overallScore: scored.overall,
        category: scored.category,
        participationPercent: scored.participationPercent,
        speakingMs,
        contributionCount: own.length,
        relevantCount: own.filter((segment) => segment.relevance === "HIGHLY_RELEVANT" || segment.relevance === "RELEVANT").length,
        irrelevantCount: own.filter((segment) => segment.relevance === "IRRELEVANT").length,
        partialCount: own.filter((segment) => segment.relevance === "PARTIALLY_RELEVANT").length,
        newIdeas: own.filter((segment) => segment.newPerspective).length,
        constructiveResponses: own.filter((segment) => segment.respondsToOthers && segment.positiveContribution).length,
        missedCount: missed.filter((item) => item.reason === "NO_RESPONSE" || item.reason === "MUTED").length,
        averageRelevance: scored.averageRelevance,
        incomplete: scored.incomplete,
        incompleteReason: scored.incompleteReason,
        adjustedScore: kept?.adjustedScore,
        adjustmentReason: kept?.adjustmentReason,
        adjustedById: kept?.adjustedById,
        adjustedAt: kept?.adjustedAt,
        formulaVersion: FORMULA_VERSION,
        parameters: {
          create: parameters.map(([key, label, weight, score, explanation]) => ({
            key,
            label,
            weight,
            score,
            explanation,
          })),
        },
        notes: {
          create: [
            ...feedback.strengths.map((body) => ({ kind: NoteKind.STRENGTH, body })),
            ...feedback.improvements.map((body) => ({ kind: NoteKind.IMPROVEMENT, body })),
            { kind: NoteKind.REMARK, body: "Scores use each person's own microphone transcript. Appearance, accent, gender, and personality are not inputs." },
            ...own.filter((segment) => segment.relevance === "HIGHLY_RELEVANT" || segment.relevance === "RELEVANT").slice(0, 2).map((segment) => ({ kind: NoteKind.EVIDENCE, body: segment.text })),
          ],
        },
      },
    });
  }

  const summaryBody = await summarise(discussion);
  const relevanceAverage = discussion.segments.length
    ? discussion.segments.filter((segment) => segment.relevance === "HIGHLY_RELEVANT" || segment.relevance === "RELEVANT").length / discussion.segments.length
    : 0;
  await prisma.discussionSummary.deleteMany({ where: { discussionId } });
  const pointRows = [
    ...summaryBody.arguments.map((body, index) => ({ kind: "ARGUMENT", body, sortOrder: index })),
    ...summaryBody.ideas.map((body, index) => ({ kind: "IDEA", body, sortOrder: index })),
    ...summaryBody.perspectives.map((body, index) => ({ kind: "PERSPECTIVE", body, sortOrder: index })),
    ...summaryBody.agreements.map((body, index) => ({ kind: "AGREEMENT", body, sortOrder: index })),
    ...summaryBody.disagreements.map((body, index) => ({ kind: "DISAGREEMENT", body, sortOrder: index })),
    { kind: "CONCLUSION", body: summaryBody.conclusion, sortOrder: 0 },
  ];
  await prisma.discussionSummary.create({
    data: {
      discussionId,
      mostActiveParticipantId: mostId,
      leastActiveParticipantId: active.length > 1 ? leastId : null,
      engagementScore: Math.round(relevanceAverage * 1000) / 10,
      source: summaryBody.source,
      points: { create: pointRows },
    },
  });

  await prisma.report.deleteMany({ where: { discussionId } });
  await prisma.report.createMany({
    data: [
      { discussionId, type: ReportType.SUMMARY },
      { discussionId, type: ReportType.COMBINED },
      { discussionId, type: ReportType.TRANSCRIPT },
      ...active.map((participant) => ({ discussionId, participantId: participant.id, type: ReportType.INDIVIDUAL })),
    ],
  });

  await Promise.all(
    active.map((participant) =>
      notify({
        userId: participant.userId,
        discussionId,
        type: "REPORT",
        title: "Your discussion report is ready",
        body: `${discussion.title} has a performance report you can open or download.`,
        href: `/participant/reports/${discussion.id}`,
      }),
    ),
  );
  await notify({
    userId: discussion.hostId,
    discussionId,
    type: "REPORT",
    title: "Discussion reports are ready",
    body: `Reports for “${discussion.title}” are ready to review.`,
    href: `/host/sessions/${discussion.id}`,
  });
  return summaryBody;
}

export async function endDiscussion(discussionId: string) {
  const existing = await prisma.discussion.findUnique({ where: { id: discussionId } });
  if (!existing || existing.status === "CANCELLED") return { ok: false as const, error: "This discussion cannot be ended." };
  if (existing.status !== "COMPLETED") {
    await prisma.discussion.update({
      where: { id: discussionId },
      data: { status: "COMPLETED", endedAt: new Date(), startedAt: existing.startedAt ?? new Date() },
    });
  }
  await expireInvites(discussionId);
  let summaryError: string | null = null;
  let summary: Awaited<ReturnType<typeof evaluateDiscussion>> = null;
  try {
    summary = await evaluateDiscussion(discussionId);
  } catch (error) {
    console.error(error);
    summaryError = "The discussion ended, but the report could not be finished. Open the session and recalculate.";
  }
  dropRoom(discussionId);
  finalizeJournal(discussionId, {
    status: "COMPLETED",
    endedAt: new Date().toISOString(),
    summary,
    summaryError,
  });
  emitDiscussion(discussionId, "meeting-ended", {
    summary,
    summaryError,
  });
  return { ok: true as const, summary, summaryError };
}

async function expireInvites(discussionId: string) {
  const live = snapshot(discussionId);
  if (!live) return;
  for (const [userId, invite] of live.invites) {
    const participant = await prisma.discussionParticipant.findFirst({ where: { id: invite.participantId, discussionId } });
    if (!participant) continue;
    const media = live.presence.get(userId);
    const reason = !media?.connected ? "DISCONNECT" : participant.micLocked ? "HOST_LOCKED" : !invite.sawUnmute && media && !media.audio ? "MUTED" : "NO_RESPONSE";
    await prisma.missedOpportunity.create({
      data: { discussionId, participantId: participant.id, reason, windowSec: invite.windowSec },
    });
    if (reason === "NO_RESPONSE" || reason === "MUTED") {
      await prisma.speakingStat.updateMany({ where: { participantId: participant.id }, data: { missedOpportunities: { increment: 1 } } });
    }
  }
  live.invites.clear();
}
