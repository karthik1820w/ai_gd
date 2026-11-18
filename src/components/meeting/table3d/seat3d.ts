/**
 * Pure maths for the 3D table. No React and no three.js in here, so all of it is unit-tested.
 *
 * Seating is not invented again: the points come from `ringPositions` (the same ones the 2D round
 * table uses), so everyone sees the same cyclic order from their own chair and the viewer's own
 * seat is nearest the camera.
 */
import { ringPositions } from "../../../lib/stageLayout.ts";

/** Smallest distance between two neighbouring characters, in world units. */
export const SEAT_SPACING = 1.2;
export const MIN_RING_RADIUS = 2.4;
/** How far inside the ring of chairs the table top ends. */
export const TABLE_INSET = 0.9;
/** Height of a seated character's head centre. */
export const HEAD_HEIGHT = 1.35;
/** Horizontal distance from the camera to the speaker's head when focused. */
export const FOCUS_DISTANCE = 2.5;
/** How far above the head the focus camera sits, so other characters never block the view. */
export const FOCUS_RISE = 0.7;
/** The radius `ringPositions` uses, in percent of the 2D table. */
const RING_PERCENT = 38;

export type Vec3 = [number, number, number];
export type SeatWorld = { x: number; z: number; yaw: number };
export type CameraPose = { position: Vec3; target: Vec3 };

/** Radius of the ring of chairs for this many people: wide enough that neighbours never overlap. */
export function ringRadius(count: number) {
  if (count < 2) return MIN_RING_RADIUS;
  // The straight-line gap between neighbours is 2 R sin(pi / n); solve that for the spacing we want.
  return Math.max(MIN_RING_RADIUS, SEAT_SPACING / (2 * Math.sin(Math.PI / count)));
}

export function tableRadius(count: number) {
  return ringRadius(count) - TABLE_INSET;
}

/** The direction a character looks, as a yaw about the y axis, so that it faces the table centre. */
export function facingYaw(x: number, z: number) {
  return Math.atan2(-x, -z);
}

/** World position and facing of every seat. +z is towards the camera, so the viewer's own seat (selfIndex) is nearest it. */
export function seatWorldPositions(count: number, selfIndex: number | null): SeatWorld[] {
  const radius = ringRadius(count);
  return ringPositions(count, selfIndex).map((point) => {
    const x = ((point.x - 50) / RING_PERCENT) * radius;
    const z = ((point.y - 50) / RING_PERCENT) * radius;
    return { x, z, yaw: facingYaw(x, z) };
  });
}

/** Camera looking at the whole table from the viewer's side, about 35 degrees down. Pulled back as the table grows. */
export function overviewPose(count: number): CameraPose {
  const radius = ringRadius(count);
  const distance = radius * 2.15 + 3.5;
  const elevation = (35 * Math.PI) / 180;
  // Aim a little towards the viewer's side so the nearest chairs are not cropped by the bottom edge.
  return { position: [0, distance * Math.sin(elevation), distance * Math.cos(elevation)], target: [0, 0.5, radius * 0.1] };
}

/** How much each name label shows: everything, names and state icons only, or only people who are doing something. */
export type LabelDensity = "full" | "compact" | "dense";
export function labelDensity(count: number): LabelDensity {
  return count <= 12 ? "full" : count <= 24 ? "compact" : "dense";
}

/**
 * Camera on the inner side of the table, above head height, looking down at the speaker's face.
 * Characters face the centre, so this is the side their faces are on.
 */
export function focusPose(seat: SeatWorld): CameraPose {
  const radius = Math.hypot(seat.x, seat.z) || 1;
  const dirX = seat.x / radius;
  const dirZ = seat.z / radius;
  return {
    position: [seat.x - dirX * FOCUS_DISTANCE, HEAD_HEIGHT + FOCUS_RISE, seat.z - dirZ * FOCUS_DISTANCE],
    target: [seat.x, HEAD_HEIGHT, seat.z],
  };
}

/** Exponential smoothing that does not depend on the frame rate: the same glide at 30 and at 144 frames a second. */
export function damp(current: number, target: number, lambda: number, dt: number) {
  return target + (current - target) * Math.exp(-lambda * dt);
}

/** Vertical field of view: wider on tall, narrow screens so the whole table still fits. */
export function fovForAspect(aspect: number) {
  if (!Number.isFinite(aspect) || aspect <= 0) return 40;
  return aspect >= 1.2 ? 40 : Math.min(72, 40 + (1.2 - aspect) * 40);
}

// ---------------------------------------------------------------- appearance

export const SKIN_TONES = ["#fde0cc", "#f6c9a4", "#e8b184", "#c98e5f", "#a66a42", "#8d5836", "#774529", "#62391f"] as const;
export const HAIR_COLORS = ["#1c1a1f", "#3a2517", "#6a4227", "#8f3d22", "#d8b46a", "#b8bcc6", "#2a9d8f", "#7b4bb8"] as const;
export const SHIRT_COLORS = ["#3f7d73", "#c4973e", "#a3463f", "#4a6fa5", "#7b5ea7", "#d98c5f", "#5a8f4e", "#2f3e46", "#c05780", "#e0b94f"] as const;
export const HAIR_STYLES = ["short", "bun", "curly", "long", "bald"] as const;
export const ACCESSORIES = ["none", "glasses", "headband", "none"] as const;

export type HairStyle = (typeof HAIR_STYLES)[number];
export type Accessory = (typeof ACCESSORIES)[number];

export type Appearance = {
  skin: string;
  hair: string;
  shirt: string;
  hairStyle: HairStyle;
  accessory: Accessory;
  /** 0 to 1, fixed per person: keeps neighbours from bobbing in step. */
  phase: number;
};

/** FNV-1a, 32 bit. */
export function hashString(value: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function pick<T>(list: readonly T[], userId: string, salt: string): T {
  return list[hashString(`${userId}:${salt}`) % list.length];
}

/** Appearance from the user id only (never the name), so a person looks the same on every client and in every session. */
export function appearanceFor(userId: string): Appearance {
  return {
    skin: pick(SKIN_TONES, userId, "skin"),
    hair: pick(HAIR_COLORS, userId, "hair"),
    shirt: pick(SHIRT_COLORS, userId, "shirt"),
    hairStyle: pick(HAIR_STYLES, userId, "style"),
    accessory: pick(ACCESSORIES, userId, "accessory"),
    phase: (hashString(`${userId}:phase`) % 1000) / 1000,
  };
}

// ---------------------------------------------------------------- quality

export type Tier = "high" | "medium" | "low";
const ORDER: Tier[] = ["high", "medium", "low"];

/** Big tables start on a cheaper tier. */
export function initialTier(count: number): Tier {
  return count > 16 ? "medium" : "high";
}

/** Step down one tier when frames are slow. Never steps back up on its own, so the picture never flip-flops. */
export function nextTier(current: Tier, averageFrameMs: number): Tier {
  if (averageFrameMs <= 22) return current;
  const index = ORDER.indexOf(current);
  return ORDER[Math.min(ORDER.length - 1, index + 1)];
}
