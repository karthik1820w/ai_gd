import type { Invite, Peer, RosterEntry, SeatInfo } from "@/components/meeting/types";
import { seatOrder, talkFill, type LayoutMode } from "@/lib/stageLayout";

/**
 * Pure view logic for the meeting room, kept out of the component so it can be tested.
 */

export type LiveOverride = { audio?: boolean; video?: boolean; hand?: boolean; speaking?: boolean };

export function qualityLabel(raw: string | undefined) {
  return raw === "poor" || raw === "lost" ? "poor" : raw === "fair" ? "fair" : "good";
}

export function connectionText(quality: string) {
  return quality === "poor" ? "Weak" : quality === "fair" ? "Fair" : "Good";
}

type BuildInput = {
  roster: RosterEntry[];
  overrides: Record<string, LiveOverride>;
  self: { userId: string; name: string; isHost: boolean };
  local: { camOn: boolean; micOn: boolean; hand: boolean; speaking: boolean; stream: MediaStream | null };
  peers: Map<string, Peer>;
  qualities: Record<string, string>;
  layout: LayoutMode;
  focusId: string | null;
  inviteUserId: string | null;
  activeSpeakers?: Set<string>;
};

/**
 * Who is shown, and how. Participants sit at the table. The host watches rather than sits, so in
 * the round layout the host appears only while speaking (and so takes the centre); in the other
 * layouts the host is one of the tiles.
 */
export function buildSeats(input: BuildInput): { seats: SeatInfo[]; selfIndex: number | null } {
  const { roster, overrides, self, local, peers, qualities, layout, focusId, inviteUserId, activeSpeakers } = input;
  const hostEntry = roster.find((person) => person.isHost);
  const hostId = hostEntry?.userId ?? (self.isHost ? self.userId : null);
  const includeHost = hostId !== null && (layout !== "round" || focusId === hostId);

  const placeholder = (isHost: boolean): RosterEntry => ({
    userId: self.userId, name: self.name, isHost, connected: true,
    audio: local.micOn, video: local.camOn, hand: local.hand, speaking: local.speaking,
    micLocked: false, speakingMs: 0, contributions: 0, invites: 0, q: "good",
  });

  const guests = roster.filter((person) => !person.isHost && (person.connected || person.userId === self.userId));
  const entries = [...guests];
  if (!self.isHost && !entries.some((person) => person.userId === self.userId)) entries.push(placeholder(false));
  if (includeHost) {
    const host = hostEntry ?? (self.isHost ? placeholder(true) : null);
    if (host && (host.connected || host.userId === self.userId)) entries.push(host);
  }

  const ordered = seatOrder(entries);
  const talkTotal = guests.reduce((sum, person) => sum + person.speakingMs, 0);
  const headcount = Math.max(1, guests.length);

  const seats: SeatInfo[] = ordered.map((person) => {
    const isSelf = person.userId === self.userId;
    const peer = peers.get(person.userId);
    const override = overrides[person.userId] ?? {};
    const remoteVideo = isSelf ? null : peer?.videoTrack ?? null;
    const localHasVideo = Boolean(local.stream && local.stream.getVideoTracks().length > 0);
    const wantsVideo = isSelf ? local.camOn : override.video ?? person.video;
    const camOn = isSelf ? local.camOn && localHasVideo : wantsVideo && Boolean(remoteVideo) && (peer?.camOn ?? false);
    return {
      userId: person.userId,
      name: person.name,
      isSelf,
      isHost: person.isHost,
      connected: person.connected || isSelf,
      camOn,
      micOn: isSelf ? local.micOn : override.audio ?? person.audio,
      hand: isSelf ? local.hand : override.hand ?? person.hand,
      speaking: isSelf ? local.speaking : Boolean(override.speaking ?? person.speaking) || Boolean(activeSpeakers?.has(person.userId)),
      invited: person.userId === inviteUserId,
      quality: qualityLabel(qualities[person.userId] ?? person.q),
      speakingMs: person.speakingMs,
      fill: person.isHost ? 0 : talkFill(person.speakingMs, talkTotal, headcount),
      remoteVideo,
      localStream: isSelf ? local.stream : null,
    };
  });
  const selfIndex = ordered.findIndex((person) => person.userId === self.userId);
  return { seats, selfIndex: selfIndex === -1 ? null : selfIndex };
}

export type CenterInput = {
  status: string;
  isHost: boolean;
  moderated: boolean;
  invite: Invite | null;
  selfId: string;
  /** Seconds left on the open invitation. */
  inviteSeconds: number;
  /** Seconds until the AI invites someone, when the floor is open and nobody is talking. */
  secondsToInvite: number | null;
};

export function centerMessage(input: CenterInput): { title: string; sub: string } {
  if (input.status === "COMPLETED") return { title: "Finished", sub: input.isHost ? "Everyone's transcript and scores are below." : "Your transcript is below." };
  if (input.status !== "LIVE") return { title: input.isHost ? "Starting" : "Waiting", sub: input.isHost ? "The floor opens in a moment." : "The host has not started yet. You will enter automatically." };
  if (input.invite) {
    const seconds = Math.max(0, input.inviteSeconds);
    return input.invite.userId === input.selfId
      ? { title: "The floor is yours", sub: `The AI invited you. ${seconds}s left. Press Speak.` }
      : { title: `${input.invite.name} is invited`, sub: `The AI is waiting for a reply · ${seconds}s` };
  }
  if (input.moderated && input.secondsToInvite !== null) return { title: "Floor open", sub: input.secondsToInvite > 0 ? `AI invites someone in ${input.secondsToInvite}s` : "The AI is choosing someone to invite…" };
  return { title: "Floor open", sub: input.isHost ? "Waiting for someone to speak." : "The floor is open. Press Speak." };
}

export function shortTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return total < 60 ? `${total}s` : `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Spaced out, so a room code is easy to read aloud. */
export function spacedCode(code: string) {
  return code.split("").join(" ");
}

/** mm:ss, or h:mm:ss, for a transcript timestamp. */
export function clockLabel(totalSec: number) {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${m}:${sec}` : `${m}:${sec}`;
}
