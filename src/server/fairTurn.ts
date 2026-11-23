// Fair Turn Scheduler: mathematically selects the next participant to invite
// based on lowest weighted speaking time with penalties for prior invitations.

export interface ParticipantTurnState {
  id: string;
  name: string;
  talkMs: number;
  turns: number;
  invites: number;
  lastSpokeAt: number;
  online: boolean;
}

export const INVITE_PENALTY_MS = 8000;

/**
 * Picks the most eligible speaker to invite during discussion pauses.
 * Prioritises participants with the least speaking time.
 * Each earlier invitation adds an 8-second penalty so one silent person
 * is not repeatedly badgered while others remain quiet.
 */
export function pickNextSpeaker(participants: ParticipantTurnState[]): ParticipantTurnState | null {
  const eligible = participants.filter((p) => p.online);
  if (eligible.length === 0) return null;

  const score = (p: ParticipantTurnState) => p.talkMs + p.invites * INVITE_PENALTY_MS;

  const sorted = [...eligible].sort((a, b) => {
    const diff = score(a) - score(b);
    if (diff !== 0) return diff;
    if (a.turns !== b.turns) return a.turns - b.turns;
    return a.lastSpokeAt - b.lastSpokeAt;
  });

  return sorted[0] || null;
}

/** Weighted lottery: less speaking time, fewer turns, and fewer prior invites mean higher odds. */
export function pickRandomNextSpeaker(participants: ParticipantTurnState[], random = Math.random): ParticipantTurnState | null {
  const eligible = participants.filter((participant) => participant.online);
  if (eligible.length === 0) return null;
  const weights = eligible.map((participant) =>
    1 / (1 + Math.max(0, participant.talkMs) / 30_000 + Math.max(0, participant.turns) * 2 + Math.max(0, participant.invites) * 1.5),
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const value = random();
  const roll = (Number.isFinite(value) ? Math.max(0, Math.min(1 - Number.EPSILON, value)) : 0) * totalWeight;
  let cumulative = 0;
  for (let index = 0; index < eligible.length; index += 1) {
    cumulative += weights[index];
    if (roll < cumulative) return eligible[index];
  }
  return eligible[eligible.length - 1];
}

