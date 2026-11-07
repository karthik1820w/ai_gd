import type { Server } from "socket.io";
import { prisma } from "@/lib/db";
import { canAccess } from "@/server/access";
import {
  acceptSpeakingTick,
  clearPresence,
  getRateBucket,
  room,
  sampleNetQuality,
  setPresence,
  setSpeaking,
} from "@/server/activity";
import { endDiscussion } from "@/server/evaluate";
import { allowMic, muteLivekitAudio, removeLivekitParticipant } from "@/server/livekit";
import { startDiscussion } from "@/server/live";
import { publishRoster } from "@/server/moderator";
import { emitDiscussion } from "@/server/realtime";
import { addSegment, segmentDTO } from "@/server/segments";
import { tokenFromCookie, verifyToken, type TokenUser } from "@/server/token";
import { take } from "@/server/rateLimit";
import { NOTICE } from "@/server/netQuality";
import { logEvent } from "@/server/journal";

declare module "socket.io" {
  interface SocketData {
    user: TokenUser;
    discussionId?: string;
    name?: string;
    lastPingAt?: number;
  }
}

export function attachSignaling(io: Server) {
  io.use(async (socket, next) => {
    const token = tokenFromCookie(socket.handshake.headers.cookie);
    const user = token ? await verifyToken(token) : null;
    if (!user) return next(new Error("unauthorized"));
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    socket.join(`user:${socket.data.user.id}`);

    // Rate limit helper
    const allowEvent = (cost = 1) => {
      const discussionId = socket.data.discussionId;
      if (!discussionId) return true;
      const bucket = getRateBucket(discussionId, socket.id);
      const ok = take(bucket, cost);
      if (!ok) socket.emit("room-error", { error: "Slow down." });
      return ok;
    };

    socket.on("watch", async (payload: { meetingId?: string; code?: string }) => {
      if (!allowEvent(1)) return;
      const user = socket.data.user;
      if (!user || !payload?.meetingId) return;
      const access = await canAccess({ meetingId: payload.meetingId, userId: user.id, role: user.role, code: payload.code });
      if (!access || "error" in access) {
        socket.emit("room-error", { error: !access ? "This meeting code is not valid." : access.error });
        return;
      }
      if (socket.data.discussionId && socket.data.discussionId !== access.discussion.id) {
        await leave(socket);
      }
      socket.data.discussionId = access.discussion.id;
      socket.join(`discussion:${access.discussion.id}`);

      logEvent(access.discussion.id, "watch", { userId: user.id, name: user.name });

      const [segments, messages, events] = await Promise.all([
        prisma.transcriptSegment.findMany({
          where: { discussionId: access.discussion.id },
          orderBy: { startedAt: "asc" },
          take: 300,
          include: { participant: true },
        }),
        prisma.chatMessage.findMany({ where: { discussionId: access.discussion.id }, orderBy: { createdAt: "asc" }, take: 100 }),
        prisma.moderatorEvent.findMany({ where: { discussionId: access.discussion.id }, orderBy: { createdAt: "desc" }, take: 20 }),
      ]);
      socket.emit("session-state", {
        status: access.discussion.status,
        startedAt: access.discussion.startedAt?.toISOString() ?? null,
        durationMin: access.discussion.durationMin,
        serverNow: Date.now(),
        isHost: access.isHost,
        topic: access.discussion.topic,
        title: access.discussion.title,
        mode: access.discussion.mode,
        moderatorEnabled: access.discussion.moderatorEnabled,
        transcriptionEnabled: access.discussion.transcriptionEnabled,
        recordingEnabled: access.discussion.recordingEnabled,
      });
      socket.emit("transcript-history", segments.map(segmentDTO));
      socket.emit("chat-history", messages.map((message) => ({ id: message.id, userId: message.userId, name: message.name, text: message.text, createdAt: message.createdAt.toISOString() })));
      socket.emit("moderator-history", events.reverse().map((event) => ({ id: event.id, situation: event.situation, message: event.message, source: event.source, targetUserId: event.targetUserId, createdAt: event.createdAt.toISOString() })));
      await publishRoster(access.discussion.id);
    });

    socket.on("join-media", async (payload: { audio?: boolean; video?: boolean; hand?: boolean; speechAvailable?: boolean }) => {
      if (!allowEvent(2)) return;
      const discussionId = socket.data.discussionId;
      const user = socket.data.user;
      if (!discussionId || !user) return;
      const discussion = await prisma.discussion.findUnique({ where: { id: discussionId } });
      if (!discussion || discussion.status === "COMPLETED" || discussion.status === "CANCELLED") {
        socket.emit("room-error", { error: "This discussion has ended." });
        return;
      }
      const isHost = discussion.hostId === user.id;
      if (!isHost && discussion.status !== "LIVE") {
        socket.emit("waiting");
        return;
      }
      if (isHost && discussion.status === "SCHEDULED") await startDiscussion(discussion.id);
      const participant = await prisma.discussionParticipant.findUnique({ where: { discussionId_userId: { discussionId, userId: user.id } } });
      if (!participant || participant.removed) {
        socket.emit("room-error", { error: "Join the discussion from the lobby before turning media on." });
        return;
      }
      socket.data.name = participant.displayName;
      const existing = room(discussionId).presence.get(user.id);
      if (existing && existing.socketId !== socket.id) {
        io.to(existing.socketId).emit("replaced");
        io.sockets.sockets.get(existing.socketId)?.disconnect(true);
      }
      await prisma.discussionParticipant.update({
        where: { id: participant.id },
        data: {
          joinedAt: participant.joinedAt ?? new Date(),
          leftAt: null,
          mediaReady: Boolean(payload.audio),
          speechAvailable: payload.speechAvailable !== false,
        },
      });
      await prisma.speakingStat.upsert({ where: { participantId: participant.id }, create: { participantId: participant.id }, update: {} });

      logEvent(discussionId, "join", { id: participant.id, userId: user.id, name: participant.displayName });

      const others = [...room(discussionId).presence.entries()]
        .filter(([userId]) => userId !== user.id)
        .map(([userId, media]) => ({ socketId: media.socketId, userId, name: findName(discussionId, userId) }));
      setPresence(discussionId, user.id, {
        socketId: socket.id,
        audio: Boolean(payload.audio),
        video: Boolean(payload.video),
        hand: Boolean(payload.hand),
        screen: false,
        connected: true,
      });
      socket.emit("peers", await namedPeers(discussionId, others));
      socket.to(`discussion:${discussionId}`).emit("peer-joined", { socketId: socket.id, userId: user.id, name: participant.displayName });
      await publishRoster(discussionId);
    });

    socket.on("signal", (payload: { to?: string; data?: unknown }) => {
      if (!allowEvent(1)) return;
      if (!payload?.to || !socket.data.discussionId) return;
      const target = io.sockets.sockets.get(payload.to);
      if (!target || target.data.discussionId !== socket.data.discussionId) return;
      target.emit("signal", { from: socket.id, userId: socket.data.user.id, name: socket.data.name ?? socket.data.user.name, data: payload.data });
    });

    socket.on("media-state", async (payload: { audio?: boolean; video?: boolean; hand?: boolean; screen?: boolean }) => {
      if (!allowEvent(1)) return;
      const discussionId = socket.data.discussionId;
      if (!discussionId) return;
      const current = room(discussionId).presence.get(socket.data.user.id);
      setPresence(discussionId, socket.data.user.id, {
        socketId: socket.id,
        audio: Boolean(payload?.audio),
        video: Boolean(payload?.video),
        hand: Boolean(payload?.hand),
        screen: Boolean(payload?.screen),
        connected: true,
      });
      if (!current && !payload) return;
      emitDiscussion(discussionId, "media", { userId: socket.data.user.id, audio: Boolean(payload?.audio), video: Boolean(payload?.video), hand: Boolean(payload?.hand), screen: Boolean(payload?.screen) });
    });

    socket.on("speaking", async (payload: { speaking?: boolean }) => {
      if (!allowEvent(1)) return;
      const discussionId = socket.data.discussionId;
      if (!discussionId) return;
      const speaking = Boolean(payload?.speaking);
      setSpeaking(discussionId, socket.data.user.id, speaking);

      logEvent(discussionId, "speaking", { userId: socket.data.user.id, speaking });

      // Synchronize floor mic permission with LiveKit if discussion is active
      const discussion = await prisma.discussion.findUnique({ where: { id: discussionId }, select: { meetingId: true, mode: true } });
      if (discussion?.meetingId && discussion.mode === "AI_MODERATED") {
        allowMic(discussion.meetingId, socket.data.user.id, speaking).catch(() => undefined);
      }

      if (speaking && acceptSpeakingTick(discussionId, socket.data.user.id)) {
        const participant = await prisma.discussionParticipant.findUnique({ where: { discussionId_userId: { discussionId, userId: socket.data.user.id } } });
        if (participant) {
          await prisma.speakingStat.upsert({
            where: { participantId: participant.id },
            create: { participantId: participant.id, speakingMs: 1000 },
            update: { speakingMs: { increment: 1000 } },
          });
        }
      }
      emitDiscussion(discussionId, "speaking", { userId: socket.data.user.id, speaking });
    });

    socket.on("transcript", async (payload: { text?: string; startedAt?: string; endedAt?: string }) => {
      if (!allowEvent(1)) return;
      if (!socket.data.discussionId || !payload?.text) return;
      logEvent(socket.data.discussionId, "speech", { userId: socket.data.user.id, text: payload.text });
      await addSegment({ discussionId: socket.data.discussionId, userId: socket.data.user.id, text: payload.text, startedAt: payload.startedAt, endedAt: payload.endedAt });
    });

    socket.on("chat", async (payload: { text?: string }) => {
      if (!allowEvent(1)) return;
      const discussionId = socket.data.discussionId;
      const text = payload?.text?.trim() ?? "";
      if (!discussionId || text.length < 1 || text.length > 1000) return;
      const message = await prisma.chatMessage.create({
        data: { discussionId, userId: socket.data.user.id, name: socket.data.name || socket.data.user.name, text },
      });
      logEvent(discussionId, "chat", { userId: socket.data.user.id, text });
      emitDiscussion(discussionId, "chat", { id: message.id, userId: message.userId, name: message.name, text: message.text, createdAt: message.createdAt.toISOString() });
    });

    socket.on("net", async (payload: { rtt?: number; loss?: number }) => {
      if (!allowEvent(1)) return;
      const discussionId = socket.data.discussionId;
      const user = socket.data.user;
      if (!discussionId || !user) return;
      const newLevel = sampleNetQuality(discussionId, user.id, payload);
      if (newLevel) {
        socket.emit("net-notice", { level: newLevel, text: NOTICE[newLevel] });
        emitDiscussion(discussionId, "net-alert", {
          userId: user.id,
          name: socket.data.name ?? user.name,
          level: newLevel,
          text: NOTICE[newLevel],
        });
        await publishRoster(discussionId);
      }
    });

    socket.on("technical", async (payload: { kind?: string; detail?: string }) => {
      if (!allowEvent(1)) return;
      const discussionId = socket.data.discussionId;
      const kind = payload?.kind?.slice(0, 40);
      if (!discussionId || !kind) return;
      const participant = await prisma.discussionParticipant.findUnique({ where: { discussionId_userId: { discussionId, userId: socket.data.user.id } } });
      if (!participant) return;
      const recent = await prisma.technicalIssue.findFirst({ where: { participantId: participant.id, kind, createdAt: { gt: new Date(Date.now() - 60_000) } } });
      if (recent) return;
      await prisma.technicalIssue.create({ data: { discussionId, participantId: participant.id, kind, detail: payload.detail?.slice(0, 200) ?? "" } });
      await prisma.speakingStat.upsert({
        where: { participantId: participant.id },
        create: { participantId: participant.id, technicalIssues: 1 },
        update: { technicalIssues: { increment: 1 } },
      });
      logEvent(discussionId, "technical", { userId: socket.data.user.id, kind });
    });

    socket.on("host-mute", async (payload: { userId?: string; locked?: boolean }) => {
      if (!allowEvent(1)) return;
      const discussion = await hostDiscussion(socket);
      if (!discussion || !payload?.userId || payload.userId === discussion.hostId) return;
      await prisma.discussionParticipant.updateMany({
        where: { discussionId: discussion.id, userId: payload.userId },
        data: { micLocked: Boolean(payload.locked) },
      });
      await muteLivekitAudio(discussion.meetingId, payload.userId, Boolean(payload.locked)).catch((error) => console.error("Could not mute the media track.", error));
      await allowMic(discussion.meetingId, payload.userId, !payload.locked).catch(() => undefined);
      const presence = room(discussion.id).presence.get(payload.userId);
      if (presence) io.to(presence.socketId).emit("force-mute", { locked: Boolean(payload.locked) });
      logEvent(discussion.id, "host-mute", { targetUserId: payload.userId, locked: Boolean(payload.locked) });
      await publishRoster(discussion.id);
    });

    socket.on("host-remove", async (payload: { userId?: string }) => {
      if (!allowEvent(1)) return;
      const discussion = await hostDiscussion(socket);
      if (!discussion || !payload?.userId || payload.userId === discussion.hostId) return;
      await prisma.discussionParticipant.updateMany({ where: { discussionId: discussion.id, userId: payload.userId }, data: { removed: true, leftAt: new Date() } });
      await removeLivekitParticipant(discussion.meetingId, payload.userId).catch((error) => console.error("Could not remove the media participant.", error));
      const presence = room(discussion.id).presence.get(payload.userId);
      if (presence) {
        io.to(presence.socketId).emit("removed");
        io.sockets.sockets.get(presence.socketId)?.disconnect(true);
      }
      logEvent(discussion.id, "host-remove", { targetUserId: payload.userId });
      await publishRoster(discussion.id);
    });

    socket.on("end-meeting", async () => {
      if (!allowEvent(1)) return;
      const discussion = await hostDiscussion(socket);
      if (!discussion) return;
      logEvent(discussion.id, "end");
      await endDiscussion(discussion.id);
    });

    socket.on("leave", () => leave(socket));
    socket.on("disconnect", () => leave(socket));
  });
}

async function hostDiscussion(socket: { data: { user: TokenUser; discussionId?: string } }) {
  if (!socket.data.discussionId) return null;
  const discussion = await prisma.discussion.findUnique({ where: { id: socket.data.discussionId } });
  if (!discussion || discussion.hostId !== socket.data.user.id) return null;
  return discussion;
}

function findName(discussionId: string, userId: string) {
  return userId || discussionId;
}

async function namedPeers(discussionId: string, peers: Array<{ socketId: string; userId: string; name: string }>) {
  const participants = await prisma.discussionParticipant.findMany({ where: { discussionId, userId: { in: peers.map((peer) => peer.userId) } } });
  const names = new Map(participants.map((participant) => [participant.userId, participant.displayName]));
  return peers.map((peer) => ({ ...peer, name: names.get(peer.userId) || peer.name }));
}

async function leave(socket: { id: string; data: { user?: TokenUser; discussionId?: string }; to: (room: string) => { emit: (event: string, payload: unknown) => void } }) {
  const discussionId = socket.data.discussionId;
  const user = socket.data.user;
  if (!discussionId || !user) return;
  clearPresence(discussionId, user.id, socket.id);
  logEvent(discussionId, "leave", { userId: user.id });
  socket.to(`discussion:${discussionId}`).emit("peer-left", { socketId: socket.id, userId: user.id });
  const participant = await prisma.discussionParticipant.findUnique({ where: { discussionId_userId: { discussionId, userId: user.id } } });
  if (participant) await prisma.discussionParticipant.update({ where: { id: participant.id }, data: { leftAt: new Date() } });
  await publishRoster(discussionId);
  socket.data.discussionId = undefined;
}
