import { NoteKind, ReportType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { aiEnabled, aiModel, clearRoomAIBudget, complete, parseJson } from "@/server/ai";
import { aliasPeople, aliasText, deAlias, EVALUATION_SCHEMA, taskPrompt, type Aliases } from "@/server/aiPrompts";
import { aiWeights, scoreAIPillars } from "@/server/aiScoring";
import { waitForPendingAnalysis } from "@/server/segments";
import { dropRoom, snapshot } from "@/server/activity";
import { finalizeJournal } from "@/server/journal";
import { notify } from "@/server/notify";
import { emitDiscussion } from "@/server/realtime";
import { blendExaminer, computeRubric, parseRubricWeights } from "@/server/rubric";
import { buildTranscript } from "@/server/transcript";
import { transcribeRecordings } from "@/server/transcribeRecordings";
import { FORMULA_VERSION, buildFeedback, classifyStatement, scoreParticipant, type PriorLine, type RelevanceLabel } from "@/server/scoring";

type GeminiParticipantReview = {
  knowledge: number;
  thinking: number;
  strengths: string[];
  improvements: string[];
  conceptsCovered: string[];
  conceptsMissed: string[];
  accuracyNotes: string[];
  feedback: string;
};

type GeminiReview = {
  participants: Map<string, GeminiParticipantReview>;
  group: {
    summary: string;
    keyInsights: string[];
    agreements: string[];
    disagreements: string[];
    missedTopics: string[];
    quality: number;
    bestContribution: { name: string; why: string } | null;
  };
  aliases: Aliases;
};

function boundedStrings(value: unknown, aliases: Aliases, limit = 5) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
        .map((item) => deAlias(item.trim().slice(0, 500), aliases))
        .filter(Boolean)
        .slice(0, limit)
    : [];
}

async function geminiReview(discussion: {
  id: string;
  hostId: string;
  topic: string;
  description: string;
  context: string;
  aiBrief: string | null;
  participants: Array<{ id: string; userId: string; displayName: string; stat: { speakingMs: number; contributionCount: number } | null }>;
  segments: Array<{
    text: string;
    relevance: string;
    accuracy: string;
    understandingScore: number | null;
    reasoningScore: number | null;
    originalityScore: number | null;
    respondsToOthers: boolean;
    participant: { userId: string };
  }>;
  missed: Array<{ participantId: string }>;
}): Promise<GeminiReview | null> {
  if (!aiEnabled()) return null;
  const aliases = aliasPeople(discussion.participants.map((person) => ({ id: person.userId, name: person.displayName })));
  const transcript = discussion.segments.slice(-160).map((segment) => {
    const alias = aliases.byId.get(segment.participant.userId) || "speaker";
    return `${alias}: ${aliasText(segment.text, aliases)} [acc:${segment.accuracy}; u:${segment.understandingScore == null ? "?" : Math.round(segment.understandingScore / 20)}; r:${segment.reasoningScore == null ? "?" : Math.round(segment.reasoningScore / 20)}]`;
  }).join("\n");
  const stats = discussion.participants
    .filter((person) => person.userId !== discussion.hostId && aliases.byId.has(person.userId))
    .map((person) => `${aliases.byId.get(person.userId)} turns=${person.stat?.contributionCount ?? 0}, speakingSeconds=${Math.round((person.stat?.speakingMs ?? 0) / 1000)}, missedInvites=${discussion.missed.filter((item) => item.participantId === person.id).length}`)
    .join("\n");
  const brief = (() => {
    try {
      const parsed = discussion.aiBrief ? JSON.parse(discussion.aiBrief) as Record<string, unknown> : {};
      if (parsed.status !== "ready") return "";
      return JSON.stringify({
        summary: parsed.summary,
        key_concepts: parsed.key_concepts,
        key_facts: parsed.key_facts,
        rubric: parsed.rubric,
      }).slice(0, 4000);
    } catch {
      return "";
    }
  })();
  try {
    const raw = await complete(
      taskPrompt("EVALUATION", "Evaluate each listed alias using only the supplied briefing, stats, and transcript. Return a JSON object matching the schema. For each alias return knowledge and thinking scores from 0 to 100, strengths, improvements, concepts_covered, concepts_missed, accuracy_notes, and feedback. Participation is calculated by code and must not be estimated. Anchors: 90+ exceptional, 75-89 strong, 60-74 adequate, 40-59 weak, below 40 poor. Cite only transcript-supported short quotes of at most 12 words. Do not invent contributions or feedback for silent participants; give them zero knowledge and thinking and empty lists. Provide group summary, key_insights, agreements, disagreements, missed_topics, quality, and best_contribution {alias,why}."),
      `Topic: ${aliasText(discussion.topic, aliases)}\nDescription: ${aliasText(discussion.description, aliases)}\n<context>${aliasText(discussion.context, aliases)}</context>\n<briefing>${aliasText(brief, aliases)}</briefing>\n<participant_stats>\n${stats}\n</participant_stats>\n<transcript>\n${transcript}\n</transcript>`,
      { tier: "final", responseSchema: EVALUATION_SCHEMA, roomId: discussion.id },
    );
    if (!raw) return null;
    const parsed = parseJson(raw);
    const result = new Map<string, GeminiParticipantReview>();
    const people = Array.isArray(parsed.participants) ? parsed.participants : [];
    for (const value of people) {
      if (!value || typeof value !== "object") continue;
      const person = value as Record<string, unknown>;
      const alias = typeof person.alias === "string" ? person.alias : "";
      if (!aliases.byAlias.has(alias)) continue;
      result.set(alias, {
        knowledge: clampScore(person.knowledge),
        thinking: clampScore(person.thinking),
        strengths: boundedStrings(person.strengths, aliases),
        improvements: boundedStrings(person.improvements, aliases),
        conceptsCovered: boundedStrings(person.concepts_covered, aliases),
        conceptsMissed: boundedStrings(person.concepts_missed, aliases),
        accuracyNotes: boundedStrings(person.accuracy_notes, aliases),
        feedback: typeof person.feedback === "string" ? deAlias(person.feedback.slice(0, 1000), aliases) : "",
      });
    }
    const group = parsed.group && typeof parsed.group === "object" ? parsed.group as Record<string, unknown> : {};
    const best = group.best_contribution && typeof group.best_contribution === "object"
      ? group.best_contribution as Record<string, unknown>
      : null;
    return {
      participants: result,
      aliases,
      group: {
        summary: typeof group.summary === "string" ? deAlias(group.summary.slice(0, 1200), aliases) : "",
        keyInsights: boundedStrings(group.key_insights, aliases),
        agreements: boundedStrings(group.agreements, aliases),
        disagreements: boundedStrings(group.disagreements, aliases),
        missedTopics: boundedStrings(group.missed_topics, aliases),
        quality: clampScore(group.quality),
        bestContribution: best && typeof best.alias === "string" && aliases.byAlias.has(best.alias)
          ? { name: deAlias(best.alias, aliases), why: typeof best.why === "string" ? deAlias(best.why.slice(0, 500), aliases) : "" }
          : null,
      },
    };
  } catch (error) {
    console.error("Gemini final evaluation failed; using heuristic scoring.", error);
    return null;
  }
}

function clampScore(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

async function summarise(discussion: {
  topic: string;
  segments: Array<{ text: string; relevance: string; participant: { displayName: string }; newPerspective: boolean }>;
}, group?: GeminiReview["group"]) {
  const usable = discussion.segments.filter((segment) => segment.relevance !== "IRRELEVANT" && segment.relevance !== "PENDING");
  const fallback = {
    source: "heuristic",
    arguments: usable.slice(0, 5).map((segment) => `${segment.participant.displayName}: ${segment.text}`),
    ideas: discussion.segments.filter((segment) => segment.newPerspective).slice(0, 5).map((segment) => segment.text),
    perspectives: [...new Map(usable.map((segment) => [segment.participant.displayName, segment.text])).entries()].map(([name, text]) => `${name}: ${text}`),
    agreements: usable.filter((segment) => /\b(i agree|shared|support)\b/i.test(segment.text)).map((segment) => segment.text).slice(0, 4),
    disagreements: usable.filter((segment) => /\b(however|disagree|but)\b/i.test(segment.text)).map((segment) => segment.text).slice(0, 4),
    conclusion: usable.length
      ? `The group produced ${usable.length} on-topic contributions about ${discussion.topic}.`
      : `The captured discussion did not produce enough on-topic speech to summarise ${discussion.topic}.`,
    bestContribution: null as { name: string; why: string } | null,
    quality: null as number | null,
    missedTopics: [] as string[],
  };
  if (group && discussion.segments.length > 0) {
    return {
      source: "gemini",
      arguments: group.keyInsights,
      ideas: group.keyInsights,
      perspectives: fallback.perspectives,
      agreements: group.agreements,
      disagreements: group.disagreements,
      conclusion: group.summary || fallback.conclusion,
      bestContribution: group.bestContribution,
      quality: group.quality,
      missedTopics: group.missedTopics,
    };
  }
  return fallback;
}

export async function evaluateDiscussion(discussionId: string) {
  await waitForPendingAnalysis(discussionId, 8_000);
  // Fill transcript gaps (browsers without speech recognition) from stored recordings.
  await transcribeRecordings(discussionId).catch((error) => console.error("Recording transcription failed; scoring continues with the live transcript.", error));
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
  const review = await geminiReview(discussion);
  const configuredWeights = aiWeights();
  const rubricWeights = parseRubricWeights().weights;
  // Generated transcript: fragments merged into whole speaking turns, used for clarity scoring.
  const transcriptDoc = buildTranscript({
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
    const alias = review?.aliases.byId.get(participant.userId);
    const examiner = alias ? review?.participants.get(alias) : undefined;
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
      examiner,
      weights: configuredWeights.weights,
    });
    const clarity = transcriptDoc.speakers.find((speaker) => speaker.speakerId === participant.id)?.clarity ?? null;
    const rubric = computeRubric({
      scored,
      communication: clarity,
      knowledge: pillars.knowledge,
      reasoning: examiner ? blendExaminer(examiner.thinking, scored.reasoning ?? 0) : null,
      weights: rubricWeights,
    });
    const heuristicFeedback = buildFeedback({
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
    const feedback = own.length && examiner
      ? {
          strengths: examiner.strengths,
          improvements: examiner.improvements,
          remark: examiner.feedback,
        }
      : own.length
        ? { ...heuristicFeedback, remark: "" }
        : { strengths: [], improvements: [], remark: "No contributions were recorded" };
    const kept = adjustments.get(participant.id);
    const parameters = rubric.parameters;
    await prisma.evaluation.create({
      data: {
        discussionId,
        participantId: participant.id,
        overallScore: rubric.overall,
        category: rubric.category,
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
        knowledgePillar: pillars.knowledge,
        participationPillar: pillars.participation,
        thinkingPillar: pillars.thinking,
        source: examiner ? "gemini" : "heuristic",
        model: examiner ? aiModel("final") : null,
        parameters: {
          create: parameters.map(({ key, label, weight, score, explanation }) => ({
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
            { kind: NoteKind.REMARK, body: feedback.remark || (examiner ? `Evaluated by Gemini (${aiModel("final")}).` : "Gemini was unavailable; this evaluation uses heuristic scoring.") },
            { kind: NoteKind.REMARK, body: "Scores use each person's own microphone transcript. Appearance, accent, gender, and personality are not inputs." },
            ...(examiner?.conceptsCovered.map((body) => ({ kind: NoteKind.REMARK, body: `Concept covered: ${body}` })) ?? []),
            ...(examiner?.conceptsMissed.map((body) => ({ kind: NoteKind.REMARK, body: `Concept to explore: ${body}` })) ?? []),
            ...(examiner?.accuracyNotes.map((body) => ({ kind: NoteKind.REMARK, body: `Accuracy note: ${body}` })) ?? []),
            ...own.filter((segment) => segment.relevance === "HIGHLY_RELEVANT" || segment.relevance === "RELEVANT").slice(0, 2).map((segment) => ({ kind: NoteKind.EVIDENCE, body: segment.text })),
          ],
        },
      },
    });
  }

  const summaryBody = await summarise(discussion, review?.group);
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
    ...summaryBody.missedTopics.map((body, index) => ({ kind: "MISSED_TOPIC", body, sortOrder: index })),
    ...(summaryBody.bestContribution ? [{ kind: "BEST_CONTRIBUTION", body: `${summaryBody.bestContribution.name}: ${summaryBody.bestContribution.why}`, sortOrder: 0 }] : []),
    ...(summaryBody.quality == null ? [] : [{ kind: "QUALITY", body: `Discussion quality: ${summaryBody.quality}/100`, sortOrder: 0 }]),
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
  clearRoomAIBudget(discussionId);
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
