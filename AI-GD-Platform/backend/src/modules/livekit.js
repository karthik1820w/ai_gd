// LiveKit SFU integration. Tokens are minted here; microphone publishing is a SERVER-enforced permission held only by the floor holder.
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
const { LIVEKIT_URL: URL_, LIVEKIT_API_KEY: KEY, LIVEKIT_API_SECRET: SECRET } = process.env;
export const url = URL_, enabled = !!(URL_ && KEY && SECRET), publicUrl = process.env.LIVEKIT_PUBLIC_URL || URL_;
const svc = enabled ? new RoomServiceClient(URL_.replace(/^ws/, 'http'), KEY, SECRET) : null, name = c => 'gd-' + c;
export async function token(code, identity, display, role) {
  const at = new AccessToken(KEY, SECRET, { identity, name: display, ttl: '6h' });
  at.addGrant({ room: name(code), roomJoin: true, canSubscribe: true, canPublish: role === 'participant', canPublishData: false, hidden: role === 'bot', canPublishSources: role === 'participant' ? [TrackSource.CAMERA] : [] });
  return at.toJwt();
}
export async function allowMic(code, identity, on) {
  try { await svc.updateParticipant(name(code), identity, undefined, { canPublish: true, canSubscribe: true, canPublishSources: on ? [TrackSource.CAMERA, TrackSource.MICROPHONE] : [TrackSource.CAMERA] }); return true; }
  catch { return false; } // participant not connected yet: caller retries
}
