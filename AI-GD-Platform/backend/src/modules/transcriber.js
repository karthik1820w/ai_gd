// Server-side transcription: a hidden LiveKit participant subscribes to the audio of whoever holds the floor,
// segments it with an energy VAD, and sends each utterance to the STT worker. Speaker identity comes from LiveKit, so attribution is exact.
import { Room, RoomEvent, AudioStream, TrackKind } from '@livekit/rtc-node';
import * as LK from './livekit.js'; import * as F from '../services/floorController.js'; import { createSTT } from '../../../ai-engine/speech/stt.js';
export const enabled = LK.enabled && process.env.STT !== 'off';
const THRESH = Number(process.env.STT_RMS || 400), END_SIL = 60, MIN_VOICED = 15, MAX_FRAMES = 1500; // 10 ms frames: 600 ms pause ends an utterance
let stt; const sessions = new Map();
export const active = code => sessions.has(code);
export async function start(room) {
  if (sessions.has(room.code)) return; stt ||= createSTT();
  const s = { lk: new Room(), pending: 0, flushers: new Set() }; sessions.set(room.code, s);
  try {
    s.lk.on(RoomEvent.TrackSubscribed, (track, _pub, p) => { if (track.kind === TrackKind.KIND_AUDIO) listen(room, s, track, p.identity); });
    await s.lk.connect(LK.url, await LK.token(room.code, 'stt-bot', 'Transcriber', 'bot'), { autoSubscribe: true });
  } catch (e) { sessions.delete(room.code); throw e; }
}
async function listen(room, s, track, id) {
  let seg = [], pre = [], silent = 0, voiced = 0;
  const flush = () => {
    const frames = seg, v = voiced; seg = []; silent = voiced = 0; if (v < MIN_VOICED) return;
    s.pending++; stt.transcribe(Buffer.concat(frames)).then(t => { t = t.replace(/["\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim(); if (t.length > 1) F.addSpeech(room, id, t); }).catch(e => console.error('stt:', e.message)).finally(() => s.pending--);
  };
  s.flushers.add(flush);
  for await (const f of new AudioStream(track, 16000, 1)) {
    const d = f.data; let sum = 0; for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
    const loud = Math.sqrt(sum / d.length) > THRESH, buf = Buffer.from(new Int16Array(d).buffer);
    if (loud) { if (!seg.length) { seg = pre; pre = []; } seg.push(buf); silent = 0; voiced++; } // pre-roll keeps word onsets
    else if (seg.length) { seg.push(buf); if (++silent >= END_SIL) flush(); }
    else { pre.push(buf); if (pre.length > 30) pre.shift(); }
    if (seg.length >= MAX_FRAMES) flush();
  }
  flush(); s.flushers.delete(flush);
}
export async function stop(room) { // drain: flush open utterances and wait for in-flight recognition before the meeting closes
  const s = sessions.get(room.code); if (!s) return;
  s.flushers.forEach(f => f()); for (let i = 0; i < 50 && s.pending; i++) await new Promise(r => setTimeout(r, 100));
  sessions.delete(room.code); await s.lk.disconnect().catch(() => {});
}
