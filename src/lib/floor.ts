/**
 * Shared timing for the "floor" (who may speak next). The server uses these to
 * decide when the AI moderator steps in; the room uses the same numbers for its
 * countdown, so the two never disagree.
 */

/** The floor has been open this long (nobody speaking): the AI moderator invites someone. */
export const INVITE_AFTER_MS = 5_000;

/** The moderator waits this long after the discussion starts before inviting anyone. */
export const FIRST_INVITE_AFTER_MS = 15_000;

/** Minimum gap between two moderator messages, so the room is never talked over by the AI. */
export const PROMPT_COOLDOWN_MS = 6_000;

/** The host must be missing this long before the AI moderator takes over (a blink is not an absence). */
export const HOST_AWAY_GRACE_MS = 10_000;

/** When time is up while someone is mid-sentence, they get this long to finish before the meeting ends. */
export const AUTO_END_SPEAKER_GRACE_MS = 20_000;

/** A speaker whose voice reports stop arriving for this long is treated as finished, so the floor never sticks. */
export const FLOOR_STALE_MS = 12_000;

/** While speaking, the browser repeats "speaking" at this interval so the server knows the floor is still in use. */
export const SPEAKING_HEARTBEAT_MS = 3_000;

/** Seconds left before the moderator invites someone, never negative. */
export function secondsUntilInvite(lastSpeechAt: number, now: number, afterMs = INVITE_AFTER_MS) {
  return Math.max(0, Math.ceil((afterMs - (now - lastSpeechAt)) / 1000));
}

/**
 * Has the scheduled time run out? When it has, the meeting ends by itself, host connected or not.
 * Someone in the middle of a sentence is allowed AUTO_END_SPEAKER_GRACE_MS to finish.
 */
export function shouldAutoEnd(input: { startedAt: number | null; durationMin: number; now: number; someoneSpeaking: boolean }) {
  if (input.startedAt == null) return false;
  const endsAt = input.startedAt + input.durationMin * 60_000;
  if (input.now < endsAt) return false;
  return !input.someoneSpeaking || input.now >= endsAt + AUTO_END_SPEAKER_GRACE_MS;
}

export type HostWatch = { missingSince: number | null; away: boolean };

/**
 * Tracks whether the host is gone long enough for the AI moderator to take over. The meeting itself never
 * depends on the host being connected. `changed` is set on the tick where `away` flips.
 */
export function nextHostWatch(previous: HostWatch, hostPresent: boolean, now: number): HostWatch & { changed: boolean } {
  if (hostPresent) return { missingSince: null, away: false, changed: previous.away };
  const missingSince = previous.missingSince ?? now;
  const away = previous.away || now - missingSince >= HOST_AWAY_GRACE_MS;
  return { missingSince, away, changed: away !== previous.away };
}
