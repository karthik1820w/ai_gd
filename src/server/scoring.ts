import { embed, cosine } from "./embed.ts";
import { PARTICIPATION_CONFIG as PARTICIPATION } from "./participationConfig.ts";

export const COOKIE = "quorum_token";
export const FORMULA_VERSION = "3";

/** Speaking time (from voice activity) that counts as "the person did speak". */
export const HEARD_SPEECH_MS = 5_000;

export const WEIGHTS = {
  topicRelevance: 0.25,
  communication: 0.2,
  knowledge: 0.2,
  participation: 0.15,
  reasoning: 0.1,
  listening: 0.1,
} as const;

export type RelevanceLabel = "HIGHLY_RELEVANT" | "RELEVANT" | "PARTIALLY_RELEVANT" | "IRRELEVANT" | "PENDING";

export const RELEVANCE_POINTS: Record<Exclude<RelevanceLabel, "PENDING">, number> = {
  HIGHLY_RELEVANT: 100,
  RELEVANT: 78,
  PARTIALLY_RELEVANT: 48,
  IRRELEVANT: 12,
} as const;

export function clamp(n: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, n));
}

/** Grade bands, highest first. Printed in reports so a score can be read without guessing. */
export const GRADE_BANDS = [
  { min: 85, label: "Excellent" },
  { min: 70, label: "Strong" },
  { min: 55, label: "Adequate" },
  { min: 40, label: "Developing" },
  { min: 0, label: "Limited" },
] as const;

export function categoryFor(score: number | null, incomplete: boolean) {
  if (incomplete || score == null) return "Incomplete";
  return (GRADE_BANDS.find((band) => score >= band.min) ?? GRADE_BANDS[GRADE_BANDS.length - 1]).label;
}

export function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const STOP = new Set(
  "a an the of on in to for and or but with from by as at is are was were be been being this that those these it its their his her your our they them he she we you i not no yes if so than then very just about into over after before during while can could should would may might will shall do does did done have has had having also than per via".split(
    " ",
  ),
);

export function contentTokens(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP.has(word));
}

export function topicAcronyms(text: string) {
  const out: string[] = [];
  const parts = text.split(/[^A-Za-z0-9]+/);
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 2) out.push(run.map((word) => word[0].toLowerCase()).join(""));
    run = [];
  };
  for (const part of parts) {
    if (part.length > 1 && part[0] === part[0].toUpperCase() && part[0] !== part[0].toLowerCase()) run.push(part);
    else flush();
  }
  flush();
  return out;
}

export function overlapCount(left: string[], right: string[]) {
  const rightSet = new Set(right);
  const seen = new Set<string>();
  const hits: string[] = [];
  for (const token of left) {
    if (rightSet.has(token) && !seen.has(token)) {
      seen.add(token);
      hits.push(token);
    }
  }
  return hits;
}

const EVIDENCE = /\b(for example|for instance|studies|research|data|evidence|percent|%|according to|in practice|case study|\d{4})\b/i;
const LOGIC = /\b(because|therefore|thus|however|although|which means|as a result|on the other hand|so that)\b/i;
const RESPONSE = /\b(i agree|i disagree|building on|to add|your point|as you said|in response|that point|i would add|counter)\b/i;
const HOSTILE = /\b(idiot|stupid|shut up)\b/i;

/**
 * Clarity heuristic for one spoken contribution (0-100). Length band, sentence
 * shape, filler sounds and hostility only; accent and delivery are not inputs.
 * Exported so the transcript generator can score merged speaking turns rather
 * than the short fragments speech recognition emits at every pause.
 */
export function communicationScore(text: string) {
  const clean = text.trim();
  const words = wordCount(clean);
  let communication = 58;
  if (words < 4) communication = 36;
  else if (words >= 8 && words <= 70) communication = 80;
  else if (words > 110) communication = 64;
  if (/[.?!]/.test(clean)) communication += 4;
  const fillers = clean.match(/\b(um+|uh+|er+|hmm+)\b/gi)?.length ?? 0;
  communication -= (fillers / Math.max(words, 1)) * 30;
  if (HOSTILE.test(clean)) communication -= 15;
  return clamp(communication);
}

export type PriorLine = {
  text: string;
  relevance?: RelevanceLabel;
  speakerId?: string;
  at?: number;
};

export type Classification = {
  relevance: RelevanceLabel;
  reason: string;
  newPerspective: boolean;
  repeatsPrior: boolean;
  logicalArgument: boolean;
  hasEvidence: boolean;
  respondsToOthers: boolean | null;
  positiveContribution: boolean;
  communication: number;
  knowledge: number | null;
  reasoning: number | null;
  conceptHits: string[];
};

export function classifyStatement(input: {
  topic: string;
  description: string;
  text: string;
  speakerId?: string;
  previous?: PriorLine[];
  secondsSincePrevious?: number | null;
}): Classification {
  const text = input.text.trim();
  const words = wordCount(text);
  const topicTokens = [...contentTokens(`${input.topic} ${input.description}`), ...topicAcronyms(input.topic)];
  const ownTokens = contentTokens(text);
  const conceptHits = overlapCount(ownTokens, topicTokens);
  const previous = input.previous ?? [];
  const lastOther = [...previous].reverse().find((line) => line.speakerId && line.speakerId !== input.speakerId);
  const ownPrevious = previous.filter((line) => line.speakerId === input.speakerId);
  const priorOverlap = ownPrevious.length
    ? Math.max(...ownPrevious.map((line) => overlapCount(ownTokens, contentTokens(line.text)).length / Math.max(ownTokens.length, 1)))
    : 0;
  const repeatsPrior = words >= 6 && priorOverlap >= 0.62;
  const respondsByCue = RESPONSE.test(text);
  const closeReply = Boolean(lastOther) && (input.secondsSincePrevious ?? 99) <= 25 && words >= 3;
  const previousRelevant = lastOther?.relevance === "HIGHLY_RELEVANT" || lastOther?.relevance === "RELEVANT" || lastOther?.relevance === "PARTIALLY_RELEVANT";
  const respondsToOthers = respondsByCue || (closeReply && (previousRelevant || conceptHits.length > 0));
  const hasEvidence = EVIDENCE.test(text);
  const topicVec = embed(`${input.topic} ${input.description}`);
  const ownVec = embed(text);
  const semanticSim = cosine(ownVec, topicVec);
  const logicalArgument = LOGIC.test(text) || (words >= 12 && (conceptHits.length > 0 || semanticSim >= 0.20));
  const hostile = HOSTILE.test(text);

  let relevance: RelevanceLabel = "IRRELEVANT";
  if (conceptHits.length >= 2 && words >= 8) relevance = "HIGHLY_RELEVANT";
  else if (conceptHits.length >= 1 && words >= 6) relevance = "RELEVANT";
  else if (semanticSim >= 0.28 && words >= 8) relevance = "RELEVANT";
  else if (respondsToOthers && previousRelevant) relevance = "RELEVANT";
  else if (conceptHits.length >= 1 || semanticSim >= 0.16 || (respondsToOthers && words >= 4)) relevance = "PARTIALLY_RELEVANT";

  if (repeatsPrior && relevance === "HIGHLY_RELEVANT") relevance = "RELEVANT";

  const newPerspective = !repeatsPrior && (relevance === "HIGHLY_RELEVANT" || relevance === "RELEVANT") && priorOverlap < 0.35 && words >= 8;
  const positiveContribution = !hostile && relevance !== "IRRELEVANT";

  const communication = communicationScore(text);

  let knowledge = 42;
  if (relevance === "HIGHLY_RELEVANT") knowledge = 78;
  else if (relevance === "RELEVANT") knowledge = 68;
  else if (relevance === "PARTIALLY_RELEVANT") knowledge = 52;
  else knowledge = 24;
  if (hasEvidence) knowledge += 12;
  if (words >= 20 && (conceptHits.length >= 2 || semanticSim >= 0.25)) knowledge += 6;
  knowledge = clamp(knowledge);

  let reasoning = logicalArgument ? 76 : relevance === "IRRELEVANT" ? 30 : 52;
  if (hasEvidence && logicalArgument) reasoning += 8;
  if (repeatsPrior) reasoning -= 8;
  reasoning = clamp(reasoning);

  const hitText = conceptHits.length
    ? `matched topic language (${conceptHits.slice(0, 4).join(", ")})`
    : semanticSim >= 0.16
      ? `aligns semantically with the topic (${Math.round(semanticSim * 100)}% similarity)`
      : "did not use the topic language";
  const contextText = respondsToOthers ? " It responds to the surrounding discussion." : "";
  const repeatText = repeatsPrior ? " It largely repeats an earlier point from the same speaker." : "";
  const reason = `Classified as ${relevance.replaceAll("_", " ").toLowerCase()} because the contribution ${hitText}.${contextText}${repeatText}`.replace(/\s+/g, " ");

  return {
    relevance,
    reason,
    newPerspective,
    repeatsPrior,
    logicalArgument,
    hasEvidence,
    respondsToOthers,
    positiveContribution,
    communication,
    knowledge,
    reasoning,
    conceptHits,
  };
}

export type ScoreInput = {
  contributions: Array<{
    wordCount: number;
    relevance: RelevanceLabel;
    communication: number | null;
    knowledge: number | null;
    reasoning: number | null;
    respondsToOthers: boolean | null;
    positiveContribution: boolean;
    segmentId?: string;
  }>;
  speakingMs: number;
  totalSpeakingMs: number;
  participantCount: number;
  missed: { noResponse: number; muted: number; technical: number; hostLocked: number; disconnect: number };
  mediaReady: boolean;
  speechAvailable: boolean;
  blockingTechnical: boolean;
};

export type ScoreResult = {
  incomplete: boolean;
  incompleteReason: string | null;
  overall: number | null;
  category: string;
  topicRelevance: number | null;
  communication: number | null;
  knowledge: number | null;
  participation: number;
  sttIssue: boolean;
  reasoning: number | null;
  listening: number | null;
  participationPercent: number;
  averageRelevance: number | null;
  evidence: Record<"topicRelevance" | "communication" | "knowledge" | "participation" | "reasoning" | "listening", string[]>;
  confidence: Record<"topicRelevance" | "communication" | "knowledge" | "participation" | "reasoning" | "listening", number | null>;
  explanations: Record<string, string>;
};

function weightedAverage(items: ScoreInput["contributions"], pick: (item: ScoreInput["contributions"][number]) => number | null) {
  const usable = items.flatMap((item) => {
    const score = pick(item);
    return score == null ? [] : [{ score, weight: Math.max(item.wordCount, 1) }];
  });
  const weight = usable.reduce((sum, item) => sum + item.weight, 0);
  if (!weight) return null;
  return usable.reduce((sum, item) => sum + item.score * item.weight, 0) / weight;
}

export function scoreParticipant(input: ScoreInput): ScoreResult {
  const count = input.contributions.length;
  const idsFor = (predicate: (item: ScoreInput["contributions"][number]) => boolean = () => true) => input.contributions.filter(predicate).flatMap((item) => item.segmentId ? [item.segmentId] : []);
  const evidence = {
    topicRelevance: idsFor((item) => item.relevance !== "PENDING"),
    communication: idsFor((item) => item.communication != null),
    knowledge: idsFor((item) => item.knowledge != null),
    participation: idsFor(),
    reasoning: idsFor((item) => item.reasoning != null),
    listening: idsFor((item) => item.respondsToOthers != null),
  };
  const confidence = { topicRelevance: null, communication: null, knowledge: null, participation: null, reasoning: null, listening: null };
  const share = input.totalSpeakingMs > 0 ? input.speakingMs / input.totalSpeakingMs : 0;
  const participationPercent = Math.round(share * 1000) / 10;
  const fairShare = 1 / Math.max(input.participantCount, 1);
  const contributedEnough = count >= 3 || (count > 0 && share >= fairShare * 0.8);
  // The microphone was heard for a while, yet no words were captured: speech recognition failed, not the person.
  const heardNotTranscribed = count === 0 && input.speakingMs >= HEARD_SPEECH_MS;
  const heardSeconds = Math.round(input.speakingMs / 1000);

  const sttIssue = !input.speechAvailable || !input.mediaReady || input.blockingTechnical || input.missed.technical > 0 || input.missed.disconnect > 0;
  const eligibleTurns = input.contributions.filter((item) => item.wordCount >= 3);
  const substantiveTurns = input.contributions.filter((item) => item.positiveContribution && item.relevance !== "IRRELEVANT" && item.relevance !== "PENDING");
  const responseTurns = input.contributions.filter((item) => item.respondsToOthers && item.positiveContribution);
  // Joining is the only evidence-free score. Every point above 5 comes from captured speech turns or measured voice time.
  const turnPoints = Math.min(PARTICIPATION.maxTurnPoints, eligibleTurns.length * PARTICIPATION.pointsPerTurn);
  const timePoints = Math.min(PARTICIPATION.maxSpeakingPoints, Math.floor(input.speakingMs / PARTICIPATION.millisecondsPerSpeakingPoint));
  const substancePoints = Math.min(PARTICIPATION.maxSubstantivePoints, substantiveTurns.length * PARTICIPATION.pointsPerSubstantiveTurn);
  const interactionPoints = Math.min(PARTICIPATION.maxInteractionPoints, responseTurns.length * PARTICIPATION.pointsPerResponse);
  let participation = PARTICIPATION.joinBaseline + turnPoints + timePoints + substancePoints + interactionPoints;
  // Repeatedly speaking for most of a multi-person meeting cannot max the participation component.
  if (share > PARTICIPATION.dominantShareThreshold && input.participantCount >= 3 && count > 0) {
    participation = Math.min(participation - PARTICIPATION.dominantSharePenalty, PARTICIPATION.dominantShareMaximum);
  }
  participation = clamp(participation, PARTICIPATION.joinBaseline, 100);

  const incomplete = count === 0 && (heardNotTranscribed || !input.mediaReady || !input.speechAvailable || input.blockingTechnical || input.missed.technical > 0 || input.missed.disconnect > 0);
  let incompleteReason: string | null = null;
  if (incomplete) {
    const heard = heardNotTranscribed ? ` The microphone was active for about ${heardSeconds} seconds; only measured speaking time contributes to participation.` : "";
    if (heardNotTranscribed && input.speechAvailable) incompleteReason = `No words were transcribed, so content could not be scored (speech recognition returned no text).${heard}`;
    else if (!input.speechAvailable) incompleteReason = `This browser did not expose speech recognition, so spoken words were not available to score.${heard}`;
    else if (!input.mediaReady) incompleteReason = `No working microphone was detected, so there is no speech evidence to score.${heard}`;
    else if (input.missed.disconnect > 0) incompleteReason = `The connection dropped before a scorable contribution was captured.${heard}`;
    else incompleteReason = `A technical problem was logged before any contribution was captured.${heard}`;
  }

  const explanations: Record<string, string> = {
    participation: contributedEnough
      ? "Muted invitations were not penalised because this participant had already contributed a fair share."
      : heardNotTranscribed
        ? `Based on ${heardSeconds} seconds of measured speaking time; no transcript was captured.`
      : count === 0
        ? "No speech was attributed to this microphone."
        : "Based on measured contribution turns and speaking time while the microphone was available.",
  };

  if (incomplete) {
    return {
      incomplete: true,
      incompleteReason,
      overall: null,
      category: "Incomplete",
      topicRelevance: null,
      communication: null,
      knowledge: null,
      participation: Math.round(participation * 10) / 10,
      sttIssue,
      reasoning: null,
      listening: null,
      participationPercent,
      averageRelevance: null,
      evidence,
      confidence,
      explanations: {
        ...explanations,
        topicRelevance: "Not scored. Speech evidence was missing because of a technical limit.",
        communication: "Not scored. Clarity is read from a transcript, and none was stored.",
        knowledge: "Not scored. Content quality needs a captured contribution.",
        reasoning: "Not scored. Reasoning is read from captured arguments.",
        listening: "Not scored. Responses are counted from the transcript.",
      },
    };
  }

  if (count === 0) {
    const overall = Math.round(participation * 10) / 10;
    return {
      incomplete: false,
      incompleteReason: null,
      overall,
      category: categoryFor(overall, false),
      topicRelevance: null,
      communication: null,
      knowledge: null,
      participation: Math.round(participation * 10) / 10,
      sttIssue,
      reasoning: null,
      listening: null,
      participationPercent,
      averageRelevance: null,
      evidence,
      confidence,
      explanations: {
        ...explanations,
        topicRelevance: "Not enough data. No transcript was captured.",
        communication: "Not enough data. No transcript was captured.",
        knowledge: "Not enough data. No content was captured.",
        reasoning: "Not enough data. No argument was captured.",
        listening: "Not enough data. No response was captured.",
      },
    };
  }

  const topicRelevance = weightedAverage(input.contributions, (item) => item.relevance === "PENDING" ? null : RELEVANCE_POINTS[item.relevance]);
  const communication = weightedAverage(input.contributions, (item) => item.communication);
  const knowledge = weightedAverage(input.contributions, (item) => item.knowledge);
  const reasoning = weightedAverage(input.contributions, (item) => item.reasoning);
  const listeningEvidence = input.contributions.filter((item) => item.respondsToOthers != null);
  const responseRate = listeningEvidence.length ? listeningEvidence.filter((item) => item.respondsToOthers === true && item.positiveContribution).length / listeningEvidence.length : null;
  let listening: number | null = responseRate != null && input.participantCount >= 2 ? clamp(40 + responseRate * 60) : null;
  const values: Array<[number | null, number]> = [
    [topicRelevance, WEIGHTS.topicRelevance], [communication, WEIGHTS.communication], [knowledge, WEIGHTS.knowledge],
    [participation, WEIGHTS.participation], [reasoning, WEIGHTS.reasoning], [listening, WEIGHTS.listening],
  ];
  const usedWeight = values.reduce((sum, [value, weight]) => sum + (value == null ? 0 : weight), 0);
  const overall = usedWeight > 0 ? values.reduce((sum, [value, weight]) => sum + (value == null ? 0 : value * weight), 0) / usedWeight : null;

  explanations.topicRelevance = `Word-weighted average of contribution relevance.`;
  explanations.communication = "Judged from transcript length, sentence shape, and filler sounds. Accent is not an input.";
  explanations.knowledge = "Higher when contributions stay on topic and include examples or evidence.";
  explanations.reasoning = "Higher when contributions use reasons, contrasts, or consequences.";
  explanations.listening = input.participantCount < 2 ? "Only one scored speaker was present, so listening stays neutral." : "Share of contributions that respond to someone else.";

  return {
    incomplete: false,
    incompleteReason: null,
    overall: overall == null ? null : Math.round(overall * 10) / 10,
    category: categoryFor(overall, false),
    topicRelevance: topicRelevance == null ? null : Math.round(topicRelevance * 10) / 10,
    communication: communication == null ? null : Math.round(communication * 10) / 10,
    knowledge: knowledge == null ? null : Math.round(knowledge * 10) / 10,
    participation: Math.round(participation * 10) / 10,
    sttIssue,
    reasoning: reasoning == null ? null : Math.round(reasoning * 10) / 10,
    listening: listening == null ? null : Math.round(listening * 10) / 10,
    participationPercent,
    averageRelevance: topicRelevance == null ? null : Math.round(topicRelevance * 10) / 10,
    evidence,
    confidence,
    explanations,
  };
}

export function buildFeedback(input: {
  topic: string;
  score: ScoreResult;
  quotes: { relevant: string[]; evidence: string[]; response: string[] };
  counts: { irrelevant: number; repeats: number; missed: number; mutedIgnored: boolean };
}) {
  const strengths: string[] = [];
  const improvements: string[] = [];
  if (input.quotes.relevant[0]) {
    strengths.push(`Addressed “${input.topic}”. One example: “${trimQuote(input.quotes.relevant[0])}”`);
  }
  if (input.quotes.evidence[0]) strengths.push(`Supported a point with evidence: “${trimQuote(input.quotes.evidence[0])}”`);
  if (input.quotes.response[0]) strengths.push(`Responded to another participant: “${trimQuote(input.quotes.response[0])}”`);
  if (input.score.participation >= 70) strengths.push("Took a visible share of the discussion without being the only voice.");
  if (input.counts.irrelevant > 0) improvements.push(`${input.counts.irrelevant} contribution${input.counts.irrelevant === 1 ? "" : "s"} sat outside the topic.`);
  if (!input.quotes.evidence.length && (input.score.topicRelevance ?? 0) > 0) improvements.push("Arguments would be stronger with a concrete example or source.");
  if (input.score.participation < 40 && !input.score.incomplete) improvements.push("Speaking time was low compared with the rest of the group.");
  if (input.counts.repeats > 0) improvements.push("Some remarks repeated a point already made.");
  if (input.counts.missed > 0) improvements.push(`${input.counts.missed} speaking invitation${input.counts.missed === 1 ? "" : "s"} passed without a response while the microphone was available.`);
  if (input.counts.mutedIgnored) strengths.push("Later muted invitations were not penalised because earlier contributions were already sufficient.");
  if (!strengths.length) strengths.push("There were not enough on-topic, evidenced, or responsive lines to list as strengths.");
  if (!improvements.length) improvements.push("No major gap stood out from the captured transcript.");
  return { strengths, improvements };
}

function trimQuote(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 180 ? `${clean.slice(0, 177)}…` : clean;
}
