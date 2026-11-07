// Fair Turn Scheduler: picks who should be invited when the floor is silent.
// Lower weighted talk time wins; each earlier invitation adds a penalty so one quiet person isn't called repeatedly.
const INVITE_PENALTY_MS = 8000;
export function pickNextSpeaker(participants) {
  const score = p => p.talkMs + p.invites * INVITE_PENALTY_MS;
  return [...participants].sort((a, b) => score(a) - score(b) || a.turns - b.turns || a.lastSpokeAt - b.lastSpokeAt)[0] || null;
}
