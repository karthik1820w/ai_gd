import { Server } from "socket.io";

let io: Server | null = null;

export function setIO(server: Server) {
  io = server;
}

export function getIO() {
  return io;
}

export function emitDiscussion(discussionId: string, event: string, payload: unknown) {
  io?.to(`discussion:${discussionId}`).emit(event, payload);
}

export function emitUser(userId: string, event: string, payload: unknown) {
  io?.to(`user:${userId}`).emit(event, payload);
}
