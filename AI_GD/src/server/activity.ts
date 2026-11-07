import { createMeter, sample, type NetMeter, type NetQualityLevel } from "./netQuality.ts";
import { createBucket, type TokenBucket } from "./rateLimit.ts";
import type { ParticipantTurnState } from "./fairTurn.ts";

export type MediaState = {
  socketId: string;
  audio: boolean;
  video: boolean;
  hand: boolean;
  screen: boolean;
  connected: boolean;
};

export type Invite = {
  participantId: string;
  until: number;
  sawUnmute: boolean;
  windowSec: number;
};

export type FloorState = {
  userId: string;
  since: number;
};

export type Room = {
  lastSpeechAt: number;
  speaking: Set<string>;
  presence: Map<string, MediaState>;
  invites: Map<string, Invite>;
  lastPromptAt: number;
  situations: Set<string>;
  lastTick: Map<string, number>;
  started: boolean;
  floor: FloorState | null;
  hands: string[];
  netMeters: Map<string, NetMeter>;
  turns: Map<string, number>;
  invitesCount: Map<string, number>;
  lastSpokeAtMap: Map<string, number>;
  rateBuckets: Map<string, TokenBucket>;
};

const rooms = new Map<string, Room>();

export function room(discussionId: string): Room {
  let current = rooms.get(discussionId);
  if (!current) {
    current = {
      lastSpeechAt: Date.now(),
      speaking: new Set(),
      presence: new Map(),
      invites: new Map(),
      lastPromptAt: 0,
      situations: new Set(),
      lastTick: new Map(),
      started: false,
      floor: null,
      hands: [],
      netMeters: new Map(),
      turns: new Map(),
      invitesCount: new Map(),
      lastSpokeAtMap: new Map(),
      rateBuckets: new Map(),
    };
    rooms.set(discussionId, current);
  }
  return current;
}

export function markLive(discussionId: string) {
  const current = room(discussionId);
  if (!current.started) {
    current.started = true;
    current.lastSpeechAt = Date.now();
  }
}

export function setSpeaking(discussionId: string, userId: string, speaking: boolean) {
  if (speaking) {
    speakStart(discussionId, userId);
  } else {
    speakStop(discussionId, userId);
  }
}

/**
 * Authoritative floor request. Rejects if another speaker currently holds the floor.
 */
export function speakStart(discussionId: string, userId: string): boolean {
  const current = room(discussionId);
  const media = current.presence.get(userId);
  if (!media?.connected) return false;

  // Floor is already held by someone else
  if (current.floor && current.floor.userId !== userId) {
    return false;
  }

  if (!current.floor) {
    current.floor = { userId, since: Date.now() };
    current.turns.set(userId, (current.turns.get(userId) ?? 0) + 1);
  }
  current.speaking.add(userId);
  current.invites.delete(userId);
  current.hands = current.hands.filter((h) => h !== userId);
  current.lastSpeechAt = Date.now();
  current.lastSpokeAtMap.set(userId, Date.now());
  return true;
}

/**
 * Releases the floor if the user currently holds it.
 */
export function speakStop(discussionId: string, userId: string): boolean {
  const current = room(discussionId);
  current.speaking.delete(userId);
  current.lastSpeechAt = Date.now();
  current.lastSpokeAtMap.set(userId, Date.now());

  if (current.floor?.userId === userId) {
    current.floor = null;
    return true;
  }
  return false;
}

export function raiseHand(discussionId: string, userId: string): boolean {
  const current = room(discussionId);
  if (!current.hands.includes(userId) && current.floor?.userId !== userId) {
    current.hands.push(userId);
    return true;
  }
  return false;
}

export function lowerHand(discussionId: string, userId: string): void {
  const current = room(discussionId);
  current.hands = current.hands.filter((h) => h !== userId);
}

/**
 * End-of-turn detection: auto-releases the floor if the floor holder
 * has been completely silent for longer than `timeoutMs` (default 8s).
 */
export function checkFloorTimeout(discussionId: string, timeoutMs = 8000): string | null {
  const current = rooms.get(discussionId);
  if (!current?.floor) return null;

  const now = Date.now();
  const lastTick = current.lastTick.get(current.floor.userId) ?? current.floor.since;
  const lastActivity = Math.max(lastTick, current.lastSpeechAt);

  if (now - lastActivity >= timeoutMs) {
    const timedOutSpeaker = current.floor.userId;
    current.floor = null;
    current.speaking.delete(timedOutSpeaker);
    current.lastSpeechAt = now;
    return timedOutSpeaker;
  }
  return null;
}

export function noteSpeech(discussionId: string, userId: string) {
  const current = room(discussionId);
  current.lastSpeechAt = Date.now();
  current.lastSpokeAtMap.set(userId, Date.now());
  current.invites.delete(userId);
}

export function setPresence(discussionId: string, userId: string, media: MediaState) {
  const current = room(discussionId);
  current.presence.set(userId, media);
  const invite = current.invites.get(userId);
  if (invite && media.audio) invite.sawUnmute = true;

  if (media.hand && !current.hands.includes(userId)) {
    current.hands.push(userId);
  } else if (!media.hand) {
    current.hands = current.hands.filter((id) => id !== userId);
  }
}

export function clearPresence(discussionId: string, userId: string, socketId: string) {
  const current = rooms.get(discussionId);
  if (!current) return;
  const media = current.presence.get(userId);
  if (media?.socketId === socketId) {
    current.presence.delete(userId);
    current.rateBuckets.delete(socketId);
  }
  current.speaking.delete(userId);
  current.hands = current.hands.filter((id) => id !== userId);
  if (current.floor?.userId === userId) {
    current.floor = null;
    current.lastSpeechAt = Date.now();
  }
}

export function rememberPrompt(discussionId: string, situation: string) {
  const current = room(discussionId);
  current.lastPromptAt = Date.now();
  current.situations.add(situation);
}

export function recordInvite(discussionId: string, userId: string) {
  const current = room(discussionId);
  current.invitesCount.set(userId, (current.invitesCount.get(userId) ?? 0) + 1);
}

export function acceptSpeakingTick(discussionId: string, userId: string) {
  const current = room(discussionId);
  const now = Date.now();
  const previous = current.lastTick.get(userId) ?? 0;
  if (now - previous < 700) return false;
  current.lastTick.set(userId, now);
  current.lastSpeechAt = now;
  current.lastSpokeAtMap.set(userId, now);
  return true;
}

export function sampleNetQuality(
  discussionId: string,
  userId: string,
  data: { rtt?: number | null; loss?: number | null },
): NetQualityLevel | null {
  const current = room(discussionId);
  let meter = current.netMeters.get(userId);
  if (!meter) {
    meter = createMeter();
    current.netMeters.set(userId, meter);
  }
  return sample(meter, data);
}

export function getNetQuality(discussionId: string, userId: string): NetQualityLevel {
  const current = rooms.get(discussionId);
  return current?.netMeters.get(userId)?.level ?? "good";
}

export function getRateBucket(discussionId: string, socketId: string): TokenBucket {
  const current = room(discussionId);
  let bucket = current.rateBuckets.get(socketId);
  if (!bucket) {
    bucket = createBucket();
    current.rateBuckets.set(socketId, bucket);
  }
  return bucket;
}

export function snapshot(discussionId: string) {
  return rooms.get(discussionId) ?? null;
}

export function dropRoom(discussionId: string) {
  rooms.delete(discussionId);
}
