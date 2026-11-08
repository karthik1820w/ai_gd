import { AccessToken, RoomServiceClient, TrackType } from "livekit-server-sdk";

function key() {
  return process.env.LIVEKIT_API_KEY || "devkey";
}

function secret() {
  return process.env.LIVEKIT_API_SECRET || "";
}

export function livekitHttp() {
  return process.env.LIVEKIT_HOST || "http://127.0.0.1:7880";
}

export function livekitPublicUrl(request: Request) {
  if (process.env.LIVEKIT_URL) return process.env.LIVEKIT_URL;
  const forwarded = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const hostname = forwarded.split(":")[0];
  const secure = request.headers.get("x-forwarded-proto") === "https";
  return `${secure ? "wss" : "ws"}://${hostname}:7880`;
}

export async function createRoomToken(input: { room: string; identity: string; name: string; admin: boolean }) {
  if (!secret()) throw new Error("LIVEKIT_API_SECRET is not set.");
  const token = new AccessToken(key(), secret(), { identity: input.identity, name: input.name, ttl: "6h" });
  token.addGrant({
    roomJoin: true,
    room: input.room,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    roomAdmin: input.admin,
  });
  return token.toJwt();
}

function client() {
  return new RoomServiceClient(livekitHttp(), key(), secret());
}

export async function muteLivekitAudio(room: string, identity: string, muted: boolean) {
  if (!secret()) return;
  const svc = client();
  const participant = await svc.getParticipant(room, identity);
  await Promise.all(
    participant.tracks
      .filter((track) => track.type === TrackType.AUDIO)
      .map((track) => svc.mutePublishedTrack(room, identity, track.sid, muted)),
  );
}

export async function removeLivekitParticipant(room: string, identity: string) {
  if (!secret()) return;
  await client().removeParticipant(room, identity);
}
