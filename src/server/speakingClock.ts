/**
 * Speaking-time clock (pure, no database).
 *
 * The browser reports "speaking: true" when voice starts and "speaking: false" when it stops.
 * Time is credited when it STOPS, as the real length of that burst. The older code added a flat
 * second at the START of each burst, so a person with six lines could end up with three seconds.
 */

export type VoiceClock = Map<string, number>;

/** A burst longer than this is treated as a stuck "speaking" flag, not real speech. */
export const MAX_BURST_MS = 90_000;

/** Voice started. A repeated "started" for someone already speaking does not restart the clock. */
export function voiceStart(clock: VoiceClock, userId: string, now: number) {
  if (!clock.has(userId)) clock.set(userId, now);
}

/** Voice stopped. Returns the milliseconds to credit (0 when no burst was open). */
export function voiceStop(clock: VoiceClock, userId: string, now: number): number {
  const since = clock.get(userId);
  clock.delete(userId);
  if (since == null) return 0;
  return Math.max(0, Math.min(now - since, MAX_BURST_MS));
}
