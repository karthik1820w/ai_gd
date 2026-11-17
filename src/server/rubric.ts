import { WEIGHTS, categoryFor, clamp, type ScoreResult } from "./scoring.ts";

/**
 * The published scoring rubric.
 *
 *   Topic relevance                         25%
 *   Communication and clarity               20%
 *   Knowledge and content quality           20%
 *   Participation and initiative            15%
 *   Logical reasoning                       10%
 *   Listening and constructive engagement   10%
 *
 * Weights can be changed with RUBRIC_WEIGHTS (see parseRubricWeights).
 */

export const RUBRIC_KEYS = ["topicRelevance", "communication", "knowledge", "participation", "reasoning", "listening"] as const;
export type RubricKey = (typeof RUBRIC_KEYS)[number];
export type RubricWeights = Record<RubricKey, number>;

export const RUBRIC_LABELS: Record<RubricKey, string> = {
  topicRelevance: "Topic relevance",
  communication: "Communication and clarity",
  knowledge: "Knowledge and content quality",
  participation: "Participation and initiative",
  reasoning: "Logical reasoning",
  listening: "Listening and constructive engagement",
};

export function defaultRubricWeights(): RubricWeights {
  return { ...WEIGHTS };
}

/**
 * RUBRIC_WEIGHTS is a comma-separated list in rubric order:
 * topic relevance, communication, knowledge, participation, reasoning, listening.
 * Five numbers are accepted and mean "no listening criterion". Values are
 * normalised to sum to 1, so "25,20,20,15,10" and "50,40,40,30,20" are the same.
 * Anything invalid falls back to the defaults.
 */
export function parseRubricWeights(value = process.env.RUBRIC_WEIGHTS): { weights: RubricWeights; source: "configured" | "default" } {
  const fallback = { weights: defaultRubricWeights(), source: "default" as const };
  if (!value || !value.trim()) return fallback;
  const parts = value.split(",").map((part) => Number(part.trim()));
  if ((parts.length !== 5 && parts.length !== 6) || parts.some((part) => !Number.isFinite(part) || part < 0)) return fallback;
  if (parts.length === 5) parts.push(0);
  const sum = parts.reduce((total, part) => total + part, 0);
  if (!Number.isFinite(sum) || sum <= 0) return fallback;
  const weights = Object.fromEntries(RUBRIC_KEYS.map((key, index) => [key, parts[index] / sum])) as RubricWeights;
  return { weights, source: "configured" };
}

/** Gemini's whole-discussion judgement is weighted 65%, per-contribution evidence 35%. */
export function blendExaminer(examiner: number | null | undefined, perContribution: number) {
  return examiner == null ? perContribution : examiner * 0.65 + perContribution * 0.35;
}

export type RubricParameter = {
  key: RubricKey;
  label: string;
  weight: number;
  score: number | null;
  explanation: string;
};

export type RubricResult = {
  overall: number | null;
  category: string;
  incomplete: boolean;
  parameters: RubricParameter[];
};

const round1 = (value: number) => Math.round(value * 10) / 10;

export function computeRubric(input: {
  scored: ScoreResult;
  /** Clarity measured on merged speaking turns from the generated transcript. */
  communication?: number | null;
  /** Knowledge score that already blends live analysis with any Gemini review. */
  knowledge?: number | null;
  /** Reasoning score that already blends live analysis with any Gemini review. */
  reasoning?: number | null;
  weights?: RubricWeights;
}): RubricResult {
  const { scored } = input;
  const weights = input.weights ?? parseRubricWeights().weights;
  const incomplete = scored.incomplete;

  const pick = (override: number | null | undefined, base: number | null) =>
    incomplete ? null : override != null ? clamp(override) : base;
  const scores: Record<RubricKey, number | null> = {
    topicRelevance: incomplete ? null : scored.topicRelevance,
    communication: pick(input.communication, scored.communication),
    knowledge: pick(input.knowledge, scored.knowledge),
    participation: scored.participation,
    reasoning: pick(input.reasoning, scored.reasoning),
    listening: incomplete ? null : scored.listening,
  };

  const explanations: Record<RubricKey, string> = {
    topicRelevance: scored.explanations.topicRelevance ?? "",
    communication: input.communication != null && !incomplete
      ? "Judged from the generated transcript: whole speaking turns, sentence shape, and filler sounds. Accent is not an input."
      : scored.explanations.communication ?? "",
    knowledge: scored.explanations.knowledge ?? "",
    participation: scored.explanations.participation ?? "",
    reasoning: scored.explanations.reasoning ?? "",
    listening: scored.explanations.listening ?? "",
  };

  const parameters: RubricParameter[] = RUBRIC_KEYS
    .filter((key) => weights[key] > 0)
    .map((key) => ({ key, label: RUBRIC_LABELS[key], weight: weights[key], score: scores[key] == null ? null : round1(scores[key]), explanation: explanations[key] }));

  const overall = incomplete
    ? null
    : round1(RUBRIC_KEYS.reduce((sum, key) => sum + (scores[key] ?? 0) * weights[key], 0));

  return { overall, category: categoryFor(overall, incomplete), incomplete, parameters };
}
