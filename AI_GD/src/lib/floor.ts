/**
 * Shared timing for the "floor" (who may speak next). The server uses these to
 * decide when the AI moderator steps in; the room uses the same numbers for its
 * countdown, so the two never disagree.
 */

/** Silence after which, in an AI-moderated room, the moderator invites someone. */
export const INVITE_AFTER_MS = 8_000;

/** The moderator waits this long after the discussion starts before inviting anyone. */
export const FIRST_INVITE_AFTER_MS = 20_000;

/** Seconds left before the moderator invites someone, never negative. */
export function secondsUntilInvite(lastSpeechAt: number, now: number, afterMs = INVITE_AFTER_MS) {
  return Math.max(0, Math.ceil((afterMs - (now - lastSpeechAt)) / 1000));
}
