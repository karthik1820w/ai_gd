/**
 * Layout maths for the meeting stage. Pure and framework-free so it can be tested.
 */

export type LayoutMode = "round" | "speaker" | "gallery";
export const LAYOUTS: Array<{ id: LayoutMode; label: string }> = [
  { id: "round", label: "Round table" },
  { id: "speaker", label: "Speaker focus" },
  { id: "gallery", label: "Gallery" },
];

export function isLayoutMode(value: unknown): value is LayoutMode {
  return value === "round" || value === "speaker" || value === "gallery";
}

/**
 * Seat width as a percentage of the table: as large as looks good, but never wider than
 * the gap between neighbouring seats on the ring, so a crowded table does not overlap.
 */
export function seatSizePercent(count: number, radius = 38) {
  if (count <= 1) return 22;
  const chord = 2 * radius * Math.sin(Math.PI / count);
  return Math.max(5, Math.min(20, chord * 0.92));
}

export type SeatPoint = { x: number; y: number };

/**
 * Seat centres on a circle, in percent of the table (50, 50 is the middle).
 * With `selfIndex`, that seat sits at the bottom, so everyone sees the same cyclic
 * order from their own chair. Without it (the host, who is not seated) seat 0 is at the top.
 */
export function ringPositions(count: number, selfIndex: number | null = null, radius = 38): SeatPoint[] {
  if (count <= 0) return [];
  const step = (Math.PI * 2) / count;
  return Array.from({ length: count }, (_, index) => {
    const angle = selfIndex === null ? -Math.PI / 2 + index * step : Math.PI / 2 + (index - selfIndex) * step;
    return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
  });
}

/**
 * Fraction (0 to 1) of a person's fair share of talking time. The seat ring fills
 * as they approach it; a quiet person has an almost empty ring.
 */
export function talkFill(talkMs: number, totalTalkMs: number, people: number) {
  if (people <= 0 || totalTalkMs <= 0) return 0;
  const fairShare = totalTalkMs / people;
  return Math.max(0, Math.min(1, talkMs / fairShare));
}

/**
 * Chooses whose tile moves to the centre. Whoever speaks takes the centre; it is
 * held briefly after they stop, and a new speaker must keep talking for a moment
 * before taking over, so a cough or a short "yes" does not make the layout jump.
 */
export class FocusTracker {
  private startedAt = new Map<string, number>();
  private lastHeard = new Map<string, number>();
  private focus: string | null = null;

  constructor(private holdMs = 1500, private takeoverMs = 400) {}

  update(speaking: Set<string>, now: number): string | null {
    for (const id of speaking) {
      if (!this.startedAt.has(id)) this.startedAt.set(id, now);
      this.lastHeard.set(id, now);
    }
    for (const id of [...this.startedAt.keys()]) if (!speaking.has(id)) this.startedAt.delete(id);

    const holding = this.focus !== null && (speaking.has(this.focus) || now - (this.lastHeard.get(this.focus) ?? 0) < this.holdMs);
    if (this.focus !== null && speaking.has(this.focus)) return this.focus;

    // The longest-running speaker who has talked long enough to take over.
    const challengers = [...speaking]
      .filter((id) => id !== this.focus && now - (this.startedAt.get(id) ?? now) >= this.takeoverMs)
      .sort((a, b) => (this.startedAt.get(a) ?? 0) - (this.startedAt.get(b) ?? 0));
    if (challengers.length) {
      this.focus = challengers[0];
      return this.focus;
    }
    if (!holding) this.focus = null;
    return this.focus;
  }

  reset() {
    this.startedAt.clear();
    this.lastHeard.clear();
    this.focus = null;
  }
}

/** Stable seating order: by user id, so every browser agrees on who sits next to whom. */
export function seatOrder<T extends { userId: string }>(people: T[]): T[] {
  return [...people].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}
