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

