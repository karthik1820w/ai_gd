import { prisma } from "@/lib/db";
import { aiEnabled, complete, parseJson } from "@/server/ai";
import { aliasPeople, aliasText, deAlias, MODERATOR_SCHEMA, taskPrompt, type AliasEntry } from "@/server/aiPrompts";
import { checkFloorTimeout, grantFloor, handQueue, markLive, markVoiceStop, recordInvite, rememberPrompt, room, snapshot, SPEAKING_TURN_MS } from "@/server/activity";
import { emitDiscussion, emitUser } from "@/server/realtime";
import { FLOOR_STALE_MS, INVITE_AFTER_MS, nextHostWatch, nextSilenceAction, PROMPT_COOLDOWN_MS, shouldAutoEnd } from "@/lib/floor";
import { endDiscussion } from "@/server/evaluate";
import { pickRandomNextSpeaker } from "@/server/fairTurn";
import { logEvent } from "@/server/journal";
import { muteLivekitAudio } from "@/server/livekit";

const TEMPLATES = {
  OPEN_FLOOR: () => "The floor is open. Anyone can add their points.",
  SILENCE: (topic: string) => [
    `The discussion has paused. Would anyone like to add a perspective on ${topic}?`,
    `We have a quiet moment. Can someone offer an example related to ${topic}?`,
    `Let's keep going. What is one consequence of ${topic} that we have not covered?`,
  ],
  BALANCE: () => ["Thank you for that detail. Let's give someone who has spoken less a chance to respond."],
  OFF_TOPIC: (topic: string) => [`Let's come back to the topic: ${topic}.`],
  WRAP_UP: () => ["We are near the end of the scheduled time. Let's hear brief closing points."],
  HOST_AWAY: () => ["The host has lost their connection. The discussion carries on and I will keep it moving fairly until they are back."],
  HOST_BACK: () => ["The host is back. Handing the discussion back to them."],
};

async function promptText(
  situation: string,
  fallback: string,
  name?: string,
  discussionId?: string,
  people: AliasEntry[] = [],
  recentLines: Array<{ userId: string; text: string }> = [],
  briefing = "",
) {
  if (!aiEnabled()) return { text: fallback, source: "template" };
  const roster = name && !people.some((person) => person.name === name)
    ? [...people, { id: "target", name }]
    : people;
  const aliases = aliasPeople(roster);
  const target = roster.find((person) => person.name === name);
  const context = recentLines.slice(-5).map((line) => `${aliases.byId.get(line.userId) ?? "speaker"}: ${aliasText(line.text, aliases)}`).join("\n");
  try {
    const raw = await complete(
      taskPrompt("MODERATOR", "Write one open-ended question of at most 25 words for a group discussion. Build on a recent point or a rubric item if available. Do not add facts, judge participants, or discuss scores. Keep the invited participant's alias as the addressee; the server will restore their name. Return JSON with one string field question."),
      `Situation: ${situation}\nHost update: ${discussionId ? snapshot(discussionId)?.moderatorContext || "none" : "none"}\n<briefing>${aliasText(briefing, aliases)}</briefing>\n<draft>${aliasText(fallback, aliases)}</draft>\n<recent_transcript>\n${context}\n</recent_transcript>`,
      { tier: "flash", timeoutMs: situation === "INVITE" ? 2500 : 20_000, retries: situation === "INVITE" ? 0 : 2, responseSchema: MODERATOR_SCHEMA, roomId: discussionId },
    );
    if (!raw) return { text: fallback, source: "template" };
    const parsed = parseJson(raw);
    const question = typeof parsed.question === "string" ? deAlias(parsed.question.replace(/\s+/g, " ").trim(), aliases) : "";
    if (!question || question.split(/\s+/).length > 25) return { text: fallback, source: "template" };
    if (name && target && !question.includes(name)) return { text: fallback, source: "template" };
    return { text: question, source: "gemini" };
  } catch (error) {
    console.error("Gemini moderator prompt failed; using the template.", error);
    return { text: fallback, source: "template" };
  }
}

export async function say(discussionId: string, situation: string, message: string, source: string, targetUserId?: string) {
  if (snapshot(discussionId)?.aiPaused && source !== "host") return;
  const row = await prisma.moderatorEvent.create({
    data: { discussionId, situation, message, source, targetUserId },
  });
  rememberPrompt(discussionId, situation);
  if (source !== "host") room(discussionId).moderatorContext = "";
  logEvent(discussionId, "moderator", { situation, message, source, targetUserId });
  emitDiscussion(discussionId, "moderator", {
    id: row.id,
    situation,
    message,
    source,
    targetUserId: targetUserId ?? null,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Roster/floor snapshots go out at most this often; the loop itself ticks every second so timing stays tight. */
const ROSTER_EVERY_MS = 4000;
const lastRosterAt = new Map<string, number>();

export async function moderateLive() {
  const discussions = await prisma.discussion.findMany({
    where: { status: "LIVE" },
    include: {
      participants: { include: { stat: true } },
      segments: { orderBy: { startedAt: "desc" }, take: 5, include: { participant: true } },
    },
  });
  const now = Date.now();
  const liveIds = new Set(discussions.map(({ id }: { id: string }) => id));
  for (const id of lastRosterAt.keys()) if (!liveIds.has(id)) lastRosterAt.delete(id);
  for (const discussion of discussions) {
    const live = snapshot(discussion.id) ?? room(discussion.id);
    markLive(discussion.id);

    if (live.floor) {
      const remainingMs = Math.max(0, live.floor.until - now);
      emitDiscussion(discussion.id, "timer_tick", { userId: live.floor.userId, until: live.floor.until, remainingMs });
      if (remainingMs <= 10_000 && remainingMs > 9_000) emitDiscussion(discussion.id, "timer_warning", { userId: live.floor.userId, seconds: 10 });
    }

    // A speaker whose "stopped" report never arrived must not hold the floor for ever.
    const released = checkFloorTimeout(discussion.id, FLOOR_STALE_MS);
    if (released) {
      emitDiscussion(discussion.id, "speaking", { userId: released, speaking: false });
      const ms = markVoiceStop(discussion.id, released);
      if (ms >= 200) await prisma.speakingStat.updateMany({ where: { participant: { discussionId: discussion.id, userId: released } }, data: { speakingMs: { increment: Math.round(ms) } } }).catch(() => undefined);
    }

    // ---- Host presence. The meeting never ends because the host dropped; the AI takes over after a short grace. ----
    const hostPresent = Boolean(live.presence.get(discussion.hostId)?.connected);
    const watch = nextHostWatch({ missingSince: live.hostMissingSince, away: live.hostAway }, hostPresent, now);
    live.hostMissingSince = watch.missingSince;
    live.hostAway = watch.away;
    if (watch.changed) {
      emitDiscussion(discussion.id, "host-status", { away: watch.away });
      if (watch.away) {
        logEvent(discussion.id, "host-away");
      } else if (live.hostAwayAnnounced) {
        live.hostAwayAnnounced = false;
        logEvent(discussion.id, "host-back");
        if (live.speaking.size === 0) await say(discussion.id, "HOST_BACK", TEMPLATES.HOST_BACK()[0], "template");
      }
    }

    if (now - (lastRosterAt.get(discussion.id) ?? 0) >= ROSTER_EVERY_MS) {
      lastRosterAt.set(discussion.id, now);
      await emitRoster(discussion.id);
    }

    // ---- The clock. When the scheduled time is up the meeting ends by itself, host present or not.
    // Someone in the middle of a sentence is allowed a few seconds to finish. ----
    if (shouldAutoEnd({ startedAt: discussion.startedAt?.getTime() ?? null, durationMin: discussion.durationMin, now, someoneSpeaking: live.speaking.size > 0 })) {
      logEvent(discussion.id, "end", { reason: "time" });
      lastRosterAt.delete(discussion.id);
      await endDiscussion(discussion.id, { background: true, reason: "time" });
      continue;
    }

    if (live.aiPaused) continue;

    // While the host is away the AI moderator runs the room even if the host had switched it off.
    if (!discussion.moderatorEnabled && !live.hostAway) continue;
    await closeExpiredInvites(discussion.id);
    // Never talk over anyone: every moderator message waits for a free floor.
    if (live.speaking.size > 0 || live.floor) continue;

    if (live.hostAway && !live.hostAwayAnnounced) {
      live.hostAwayAnnounced = true;
      await say(discussion.id, "HOST_AWAY", TEMPLATES.HOST_AWAY()[0], "template");
      continue;
    }

    if (now - live.lastPromptAt < PROMPT_COOLDOWN_MS) continue;
    const started = discussion.startedAt?.getTime() ?? now;
    const elapsed = now - started;
    const durationMs = discussion.durationMin * 60_000;
    if (elapsed < INVITE_AFTER_MS) continue;

    const remaining = durationMs - elapsed;
    if (remaining < 90_000 && remaining > 0 && !live.situations.has("WRAP_UP")) {
      const spoken = await promptText("WRAP_UP", TEMPLATES.WRAP_UP()[0], undefined, discussion.id);
      await say(discussion.id, "WRAP_UP", spoken.text, spoken.source);
      continue;
    }

    const recent = discussion.segments;
    if (recent.length >= 3 && recent.every((segment) => segment.relevance === "IRRELEVANT") && !live.situations.has("OFF_TOPIC")) {
      const spoken = await promptText("OFF_TOPIC", TEMPLATES.OFF_TOPIC(discussion.topic)[0], undefined, discussion.id);
      await say(discussion.id, "OFF_TOPIC", spoken.text, spoken.source);
      continue;
    }

    const active = discussion.participants.filter((participant) => !participant.removed);
    const totalSpeech = active.reduce((sum, participant) => sum + (participant.stat?.speakingMs ?? 0), 0);
    const dominant = [...active].sort((a, b) => (b.stat?.speakingMs ?? 0) - (a.stat?.speakingMs ?? 0))[0];
    const silent = active.filter((participant) => (participant.stat?.contributionCount ?? 0) === 0 && participant.userId !== discussion.hostId);
    if (dominant && totalSpeech > 45_000 && active.length >= 3 && (dominant.stat?.speakingMs ?? 0) / totalSpeech > 0.65 && silent.length && !live.situations.has(`BALANCE-${dominant.userId}`)) {
      const spoken = await promptText("BALANCE", TEMPLATES.BALANCE()[0], undefined, discussion.id);
      await say(discussion.id, "BALANCE", spoken.text, spoken.source, dominant.userId);
      live.situations.add(`BALANCE-${dominant.userId}`);
      continue;
    }

    const quietFor = now - live.lastSpeechAt;

    // After five seconds of silence, invite the whole room to contribute. If another five seconds pass
    // without speech, call one participant using a participation-weighted lottery. Volunteered hands stay first.
    const silenceAction = nextSilenceAction({ quietForMs: quietFor, openFloorAt: live.silenceOpenAt, now, hasInvite: live.invites.size > 0 });
    if (quietFor < INVITE_AFTER_MS) live.silenceOpenAt = null;
    if (silenceAction === "announce") {
      live.silenceOpenAt = now;
      await say(discussion.id, "OPEN_FLOOR", TEMPLATES.OPEN_FLOOR(), "template");
      continue;
    }

    if (silenceAction === "invite") {
      const candidates = active
        // A person the host has muted cannot take the floor, so inviting them would only waste the turn.
        .filter((p) => p.userId !== discussion.hostId && !p.micLocked && live.presence?.get(p.userId)?.connected)
        .map((p) => ({
          id: p.userId,
          name: p.displayName,
          talkMs: p.stat?.speakingMs ?? 0,
          turns: live.turns?.get(p.userId) ?? p.stat?.contributionCount ?? 0,
          invites: live.invitesCount?.get(p.userId) ?? 0,
          lastSpokeAt: live.lastSpokeAtMap?.get(p.userId) ?? 0,
          online: Boolean(live.presence?.get(p.userId)?.connected),
        }));

      const approved = live.approvedQueue.map((userId) => candidates.find((candidate) => candidate.id === userId)).find(Boolean);
      const queued = approved ?? handQueue(discussion.id).map((entry) => candidates.find((candidate) => candidate.id === entry.userId)).find(Boolean);
      const nextSpeaker = queued ?? pickRandomNextSpeaker(candidates);
      if (nextSpeaker) {
        const candidateParticipant = active.find((p) => p.userId === nextSpeaker.id);
        if (candidateParticipant) {
          const seconds = Math.round(SPEAKING_TURN_MS / 1000);
          const handRaised = Boolean(queued);
          const fallback = handRaised
            ? `${candidateParticipant.displayName}, you raised your hand. Please go ahead, you have about ${seconds} seconds.`
            : `${candidateParticipant.displayName}, we would like to hear your facts about ${discussion.topic}.`;
          const spoken = { text: fallback, source: "template" };
          // Somebody may have started speaking while the question was being written: never talk over them.
          if (live.speaking.size > 0) continue;
          const granted = grantFloor(discussion.id, nextSpeaker.id);
          if (!granted) continue;
          live.invites.set(nextSpeaker.id, {
            participantId: candidateParticipant.id,
            until: granted.graceUntil,
            sawUnmute: Boolean(live.presence.get(nextSpeaker.id)?.audio),
            windowSec: seconds + Math.ceil((granted.graceUntil - granted.until) / 1000),
          });
          recordInvite(discussion.id, nextSpeaker.id);
          live.silenceOpenAt = now;
          live.situations.add(`INVITE-${nextSpeaker.id}`);
          await say(discussion.id, "INVITE", spoken.text, spoken.source, nextSpeaker.id);
          emitDiscussion(discussion.id, "floor_granted", { userId: nextSpeaker.id, until: granted.until });
          emitDiscussion(discussion.id, "speaking-turn", {
            userId: nextSpeaker.id,
            name: candidateParticipant.displayName,
            until: granted.until,
            message: spoken.text,
          });
          continue;
        }
      }
    }

    if (quietFor > discussion.silencePromptSec * 1000 && now - live.lastPromptAt > 75_000) {
      const choices = TEMPLATES.SILENCE(discussion.topic);
      const spoken = await promptText("SILENCE", choices[Math.floor(Math.random() * choices.length)], undefined, discussion.id);
      await say(discussion.id, "SILENCE", spoken.text, spoken.source);
    }
  }
  await purgeExpired();
}

async function closeExpiredInvites(discussionId: string) {
  const live = snapshot(discussionId);
  if (!live) return;
  const now = Date.now();
  for (const [userId, invite] of [...live.invites]) {
    if (now < invite.until) continue;
    const media = live.presence.get(userId);
    const participant = await prisma.discussionParticipant.findUnique({ where: { id: invite.participantId } });
    const reason = !media ? "DISCONNECT" : participant?.micLocked ? "HOST_LOCKED" : !invite.sawUnmute && media && !media.audio ? "MUTED" : media.connected ? "NO_RESPONSE" : "TECHNICAL";
    await prisma.missedOpportunity.create({
      data: { discussionId, participantId: invite.participantId, reason, windowSec: invite.windowSec },
    });
    if (reason === "NO_RESPONSE" || reason === "MUTED") {
      await prisma.speakingStat.updateMany({ where: { participantId: invite.participantId }, data: { missedOpportunities: { increment: 1 } } });
    }
    live.invites.delete(userId);
    // An invite is a temporary mic grant. Revoke an unused open mic at expiry on both
    // the browser and media server so a stale invitation cannot leave audio published.
    if (media?.audio) {
      media.audio = false;
      emitUser(userId, "floor-revoked", {});
      const discussion = await prisma.discussion.findUnique({ where: { id: discussionId }, select: { meetingId: true } });
      if (discussion) await muteLivekitAudio(discussion.meetingId, userId, true).catch(() => undefined);
      emitDiscussion(discussionId, "media", { userId, audio: false, video: media.video, hand: media.hand, screen: media.screen });
    }
    emitDiscussion(discussionId, "turn-closed", { userId, reason });
  }
}

async function emitRoster(discussionId: string) {
  const discussion = await prisma.discussion.findUnique({
    where: { id: discussionId },
    include: { participants: { include: { stat: true, technical: true } } },
  });
  if (!discussion) return;
  const live = snapshot(discussionId);
  const people = discussion.participants.filter((participant) => !participant.removed);
  const entry = (participant: (typeof people)[number]) => {
    const presence = live?.presence.get(participant.userId);
    return {
      participantId: participant.id,
      userId: participant.userId,
      name: participant.displayName,
      isHost: participant.userId === discussion.hostId,
      connected: Boolean(presence),
      audio: presence?.audio ?? false,
      video: presence?.video ?? false,
      hand: presence?.hand ?? false,
      screen: presence?.screen ?? false,
      speaking: live?.speaking.has(participant.userId) ?? false,
      micLocked: participant.micLocked,
      camLocked: participant.camLocked,
      speechAvailable: participant.speechAvailable,
      speakingMs: participant.stat?.speakingMs ?? 0,
      contributions: participant.stat?.contributionCount ?? 0,
      invites: live?.invitesCount.get(participant.userId) ?? 0,
      q: live?.netMeters?.get(participant.userId)?.level ?? "good",
    };
  };
  // Everyone sees who is in the room and how long each person has talked. Only the host also
  // receives how each contribution was judged, because those are the participants' scores.
  emitDiscussion(discussionId, "roster", people.map(entry));
  emitUser(discussion.hostId, "roster-admin", people.map((participant) => ({
    ...entry(participant),
    relevant: participant.stat?.relevantCount ?? 0,
    irrelevant: participant.stat?.irrelevantCount ?? 0,
    missed: participant.stat?.missedOpportunities ?? 0,
    technical: participant.technical.length,
  })));
  const open = live ? [...live.invites.entries()][0] : undefined;
  const hostAway = live?.hostAway ?? false;
  emitDiscussion(discussionId, "floor", {
    serverNow: Date.now(),
    lastSpeechAt: live?.lastSpeechAt ?? Date.now(),
    inviteAfterMs: INVITE_AFTER_MS,
    openFloorAt: live?.silenceOpenAt ?? null,
    moderated: discussion.moderatorEnabled || hostAway,
    hostAway,
    invite: open ? { userId: open[0], until: open[1].until } : null,
  });
  publishHandQueue(discussionId, discussion.hostId, people);
}

/**
 * The hand queue: first raised, first in line. The host receives the whole list; each person with a hand
 * up receives only their own place in it.
 */
function publishHandQueue(discussionId: string, hostId: string, people: Array<{ userId: string; displayName: string; stat?: { speakingMs: number; contributionCount: number } | null }>) {
  const queue = handQueue(discussionId);
  const byUser = new Map(people.map((person) => [person.userId, person]));
  const list = queue.flatMap((entry, index) => {
    const person = byUser.get(entry.userId);
    if (!person) return [];
    return [{
      userId: entry.userId,
      name: person.displayName,
      raisedAt: entry.raisedAt,
      position: index + 1,
      speakingMs: person.stat?.speakingMs ?? 0,
      contributions: person.stat?.contributionCount ?? 0,
    }];
  });
  emitUser(hostId, "hand-queue", { serverNow: Date.now(), queue: list });
  list.forEach((entry, index) => emitUser(entry.userId, "hand-position", { position: index + 1, of: list.length }));
}

const rosterTimers = new Map<string, NodeJS.Timeout>();

async function purgeExpired() {
  const candidates = await prisma.discussion.findMany({
    where: { status: "COMPLETED", transcriptsPurgedAt: null, retentionDays: { not: null } },
    include: { recordings: true },
  });
  const now = Date.now();
  for (const discussion of candidates) {
    if (!discussion.endedAt || !discussion.retentionDays) continue;
    if (now < discussion.endedAt.getTime() + discussion.retentionDays * 86_400_000) continue;
    const { unlink } = await import("fs/promises");
    for (const recording of discussion.recordings) await unlink(recording.path).catch(() => undefined);
    await prisma.recording.deleteMany({ where: { discussionId: discussion.id } });
    await prisma.transcriptSegment.deleteMany({ where: { discussionId: discussion.id } });
    await prisma.chatMessage.deleteMany({ where: { discussionId: discussion.id } });
    await prisma.discussion.update({ where: { id: discussion.id }, data: { transcriptsPurgedAt: new Date() } });
  }
}

/** Roster changes come in bursts (join, mute, connection notes), so they are sent once per short window. */
export function publishRoster(discussionId: string) {
  if (rosterTimers.has(discussionId)) return;
  rosterTimers.set(discussionId, setTimeout(() => {
    rosterTimers.delete(discussionId);
    emitRoster(discussionId).catch((error) => console.error("Could not publish the roster.", error));
  }, 250));
}
