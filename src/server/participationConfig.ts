/** Deterministic participation scoring weights and caps. */
export const PARTICIPATION_CONFIG = {
  joinBaseline: 5,
  minimumTurnWords: 3,
  pointsPerTurn: 5,
  maxTurnPoints: 25,
  millisecondsPerSpeakingPoint: 6_000,
  maxSpeakingPoints: 25,
  pointsPerSubstantiveTurn: 4,
  maxSubstantivePoints: 20,
  pointsPerResponse: 4,
  maxInteractionPoints: 20,
  dominantShareThreshold: 0.7,
  dominantShareMaximum: 80,
  dominantSharePenalty: 20,
} as const;
