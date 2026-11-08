import { clamp } from "./scoring.ts";

export const DEFAULT_AI_WEIGHTS = [40, 25, 35] as const;
export type AIWeights = [number, number, number];
const NORMALIZED_DEFAULTS: AIWeights = [0.4, 0.25, 0.35];

const ACCURACY_FACTORS: Record<string, number> = {
  accurate: 1,
  partly_accurate: 0.75,
  inaccurate: 0.35,
  opinion: 0.9,
  off_topic: 0.3,
  unverifiable: 0.8,
};

const RELEVANCE_VALUES: Record<string, number> = {
  HIGHLY_RELEVANT: 1,
  RELEVANT: 0.78,
  PARTIALLY_RELEVANT: 0.48,
  IRRELEVANT: 0.12,
  PENDING: 0.5,
};

export function aiWeights(value = process.env.AI_WEIGHTS): { weights: AIWeights; source: "configured" | "default" } {
  if (!value) return { weights: [...NORMALIZED_DEFAULTS], source: "default" };
  const parsed = value.split(",").map((part) => Number(part.trim()));
  if (parsed.length !== 3 || parsed.some((part) => !Number.isFinite(part) || part < 0) || parsed.every((part) => part === 0)) {
    return { weights: [...NORMALIZED_DEFAULTS], source: "default" };
  }
  const sum = parsed.reduce((total, part) => total + part, 0);
  if (!Number.isFinite(sum) || sum <= 0) return { weights: [...NORMALIZED_DEFAULTS], source: "default" };
  return { weights: parsed.map((part) => part / sum) as AIWeights, source: "configured" };
}

export function scoreAIPillars(input: {
  contributions: Array<{
    understanding?: number | null;
    reasoning?: number | null;
    originality?: number | null;
    accuracy?: string;
    relevance?: string;
    respondsToOthers?: boolean;
  }>;
  participation: number;
  examiner?: { knowledge?: number; thinking?: number };
  weights?: AIWeights;
}) {
  const contributions = input.contributions;
  const perPointKnowledge = contributions.length
    ? contributions.reduce((sum, point) => {
        const understanding = clamp(point.understanding ?? 50) / 100;
        const accuracy = ACCURACY_FACTORS[point.accuracy || "unverifiable"] ?? ACCURACY_FACTORS.unverifiable;
        const relevance = RELEVANCE_VALUES[point.relevance || "PENDING"] ?? RELEVANCE_VALUES.PENDING;
        return sum + understanding * 100 * accuracy * (0.5 + 0.5 * relevance);
      }, 0) / contributions.length
    : 0;
  const perPointThinking = contributions.length
    ? contributions.reduce((sum, point) => {
        const reasoning = clamp(point.reasoning ?? 50) / 100;
        const originality = clamp(point.originality ?? 50) / 100;
        return sum + 100 * (0.5 * reasoning + 0.25 * originality + 0.25 * (point.respondsToOthers ? 1 : 0.4));
      }, 0) / contributions.length
    : 0;
  const knowledge = contributions.length
    ? input.examiner?.knowledge == null
      ? perPointKnowledge
      : input.examiner.knowledge * 0.65 + perPointKnowledge * 0.35
    : 0;
  const thinking = contributions.length
    ? input.examiner?.thinking == null
      ? perPointThinking
      : input.examiner.thinking * 0.65 + perPointThinking * 0.35
    : 0;
  const weights = input.weights || aiWeights().weights;
  const participation = clamp(input.participation);
  const overall = Math.round(knowledge * weights[0] + participation * weights[1] + thinking * weights[2]);
  return {
    knowledge: Math.round(clamp(knowledge)),
    participation: Math.round(participation),
    thinking: Math.round(clamp(thinking)),
    overall,
    weights,
    perPointKnowledge: Math.round(clamp(perPointKnowledge)),
    perPointThinking: Math.round(clamp(perPointThinking)),
  };
}
