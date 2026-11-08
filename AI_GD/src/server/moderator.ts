import { prisma } from "@/lib/db";
import { aiEnabled, complete, parseJson } from "@/server/ai";
import { aliasPeople, aliasText, deAlias, MODERATOR_SCHEMA, taskPrompt, type AliasEntry } from "@/server/aiPrompts";
import { markLive, recordInvite, rememberPrompt, room, snapshot } from "@/server/activity";
import { emitDiscussion } from "@/server/realtime";
import { endDiscussion } from "@/server/evaluate";
import { pickNextSpeaker } from "@/server/fairTurn";
import { logEvent } from "@/server/journal";

const TEMPLATES = {
  SILENCE: (topic: string) => [
    `The discussion has paused. Would anyone like to add a perspective on ${topic}?`,
    `We have a quiet moment. Can someone offer an example related to ${topic}?`,
    `Let's keep going. What is one consequence of ${topic} that we have not covered?`,
  ],
  BALANCE: () => ["Thank you for that detail. Let's give someone who has spoken less a chance to respond."],
  OFF_TOPIC: (topic: string) => [`Let's come back to the topic: ${topic}.`],
  WRAP_UP: () => ["We are near the end of the scheduled time. Let's hear brief closing points."],
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
      `Situation: ${situation}\n<briefing>${aliasText(briefing, aliases)}</briefing>\n<draft>${aliasText(fallback, aliases)}</draft>\n<recent_transcript>\n${context}\n</recent_transcript>`,
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

async function say(discussionId: string, situation: string, message: string, source: string, targetUserId?: string) {
  const row = await prisma.moderatorEvent.create({
    data: { discussionId, situation, message, source, targetUserId },
  });
  rememberPrompt(discussionId, situation);
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

export async function moderateLive() {
  const discussions = await prisma.discussion.findMany({
    where: { status: "LIVE" },
    include: {
      participants: { include: { stat: true } },
      segments: { orderBy: { startedAt: "desc" }, take: 5, include: { participant: true } },
    },
  });
  const now = Date.now();
  for (const discussion of discussions) {
    await emitRoster(discussion.id);
    if (discussion.startedAt && discussion.retentionDays == null) {
      const ends = discussion.startedAt.getTime() + discussion.durationMin * 60_000 + 2 * 60_000;
      if (now > ends) {
        await endDiscussion(discussion.id);
        continue;
      }
    }
    if (!discussion.moderatorEnabled) continue;
    const live = snapshot(discussion.id) ?? room(discussion.id);
    markLive(discussion.id);
    await closeExpiredInvites(discussion.id);
    if (live.speaking.size > 0) continue;
    if (now - live.lastPromptAt < 20_000) continue;
    const started = discussion.startedAt?.getTime() ?? now;
    const elapsed = now - started;
    const durationMs = discussion.durationMin * 60_000;
    if (elapsed < 15_000) continue;

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

    // Mathematical Fair-Turn moderation: ensures equitable speaking opportunities
    if (discussion.mode === "AI_MODERATED" && elapsed > durationMs * 0.1 && quietFor > 8_000) {
      const candidates = active
        .filter((p) => p.userId !== discussion.hostId && live.presence?.get(p.userId)?.connected)
        .map((p) => ({
          id: p.userId,
          name: p.displayName,
          talkMs: p.stat?.speakingMs ?? 0,
          turns: live.turns?.get(p.userId) ?? p.stat?.contributionCount ?? 0,
          invites: live.invitesCount?.get(p.userId) ?? 0,
          lastSpokeAt: live.lastSpokeAtMap?.get(p.userId) ?? 0,
          online: Boolean(live.presence?.get(p.userId)?.connected),
        }));

      const nextSpeaker = pickNextSpeaker(candidates);
      if (nextSpeaker && !live.invites.has(nextSpeaker.id) && now - live.lastPromptAt > 15_000) {
        const candidateParticipant = active.find((p) => p.userId === nextSpeaker.id);
        if (candidateParticipant) {
          const seconds = discussion.speakingTimeSec;
          const fallback = `${candidateParticipant.displayName}, we have not heard your thoughts recently. You have about ${seconds} seconds if you would like to speak.`;
          const people = active.map((person) => ({ id: person.userId, name: person.displayName }));
          const recentLines = discussion.segments.slice().reverse().map((segment) => ({ userId: segment.participant.userId, text: segment.text }));
          const briefing = (() => {
            try {
              const parsed = discussion.aiBrief ? JSON.parse(discussion.aiBrief) as Record<string, unknown> : {};
              return parsed.status === "ready" ? JSON.stringify({ summary: parsed.summary, key_concepts: parsed.key_concepts, rubric: parsed.rubric }).slice(0, 2000) : "";
            } catch {
              return "";
            }
          })();
          const spoken = await promptText("INVITE", fallback, candidateParticipant.displayName, discussion.id, people, recentLines, briefing);
          live.invites.set(nextSpeaker.id, {
            participantId: candidateParticipant.id,
            until: now + seconds * 1000,
            sawUnmute: Boolean(live.presence.get(nextSpeaker.id)?.audio),
            windowSec: seconds,
          });
          recordInvite(discussion.id, nextSpeaker.id);
          live.situations.add(`INVITE-${nextSpeaker.id}`);
          await say(discussion.id, "INVITE", spoken.text, spoken.source, nextSpeaker.id);
          emitDiscussion(discussion.id, "speaking-turn", {
            userId: nextSpeaker.id,
            name: candidateParticipant.displayName,
            until: now + seconds * 1000,
            message: spoken.text,
          });
          continue;
        }
      }
    }

    if (quietFor > discussion.silencePromptSec * 1000 && !live.situations.has("SILENCE-OPEN")) {
      const choices = TEMPLATES.SILENCE(discussion.topic);
      const spoken = await promptText("SILENCE", choices[Math.floor(Math.random() * choices.length)], undefined, discussion.id);
      await say(discussion.id, "SILENCE", spoken.text, spoken.source);
      live.situations.add("SILENCE-OPEN");
    } else if (quietFor > discussion.silencePromptSec * 1000 && now - live.lastPromptAt > 75_000) {
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
  const roster = discussion.participants
    .filter((participant) => !participant.removed)
    .map((participant) => {
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
        speakingMs: participant.stat?.speakingMs ?? 0,
        contributions: participant.stat?.contributionCount ?? 0,
        relevant: participant.stat?.relevantCount ?? 0,
        irrelevant: participant.stat?.irrelevantCount ?? 0,
        missed: participant.stat?.missedOpportunities ?? 0,
        technical: participant.technical.length,
        q: live?.netMeters?.get(participant.userId)?.level ?? "good",
      };
    });
  emitDiscussion(discussionId, "roster", roster);
}

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

export async function publishRoster(discussionId: string) {
  await emitRoster(discussionId);
}
