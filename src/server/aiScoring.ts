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
    accuracy?: string | null;
    relevance?: string;
    respondsToOthers?: boolean | null;
  }>;
  participation: number;
  weights?: AIWeights;
  /**
   * False when no AI model analysed any line (heuristic scoring only). Then nothing was checked for accuracy,
   * so lines are not discounted as "unverifiable", and relevance is not counted a second time inside knowledge
   * (it already has its own 25% criterion and already shaped each line's knowledge score).
   */
  aiAnalysed?: boolean;
}) {
  const contributions = input.contributions;
  const aiAnalysed = input.aiAnalysed ?? true;
  const mean = (values: Array<number | null>) => {
    const observed = values.filter((value): value is number => value != null && Number.isFinite(value));
    return observed.length ? observed.reduce((sum, value) => sum + value, 0) / observed.length : null;
  };
  const perPointKnowledge = mean(contributions.map((point) => {
    if (point.understanding == null) return null;
    if (!aiAnalysed) return clamp(point.understanding);
    const accuracy = point.accuracy ? ACCURACY_FACTORS[point.accuracy] : undefined;
    const relevance = point.relevance ? RELEVANCE_VALUES[point.relevance] : undefined;
    if (accuracy == null || relevance == null) return null;
    return clamp(point.understanding) * accuracy * (0.5 + 0.5 * relevance);
  }));
  const perPointThinking = mean(contributions.map((point) => {
    const components: Array<[number | null | undefined, number]> = [
      [point.reasoning, 0.5], [point.originality, 0.25], [typeof point.respondsToOthers === "boolean" ? (point.respondsToOthers ? 100 : 40) : null, 0.25],
    ];
    const usable = components.filter((entry): entry is [number, number] => typeof entry[0] === "number" && Number.isFinite(entry[0]));
    const weight = usable.reduce((sum, [, partWeight]) => sum + partWeight, 0);
    return weight ? usable.reduce((sum, [value, partWeight]) => sum + clamp(value) * partWeight, 0) / weight : null;
  }));
  const knowledge = contributions.length ? perPointKnowledge : null;
  const thinking = contributions.length ? perPointThinking : null;
  const weights = input.weights || aiWeights().weights;
  const participation = clamp(input.participation);
  const values: Array<[number | null, number]> = [[knowledge, weights[0]], [participation, weights[1]], [thinking, weights[2]]];
  const usedWeight = values.reduce((sum, [value, weight]) => sum + (value == null ? 0 : weight), 0);
  const overall = usedWeight ? Math.round(values.reduce((sum, [value, weight]) => sum + (value == null ? 0 : value * weight), 0) / usedWeight) : null;
  return {
    knowledge: knowledge == null ? null : Math.round(clamp(knowledge)),
    participation: Math.round(participation),
    thinking: thinking == null ? null : Math.round(clamp(thinking)),
    overall,
    weights,
    perPointKnowledge: perPointKnowledge == null ? null : Math.round(clamp(perPointKnowledge)),
    perPointThinking: perPointThinking == null ? null : Math.round(clamp(perPointThinking)),
  };
}
