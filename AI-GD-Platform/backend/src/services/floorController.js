// Authoritative room state. Node is single-threaded, so every mutation is atomic; each one bumps `v` so clients can drop stale state.
import { pickNextSpeaker } from '../../../ai-engine/moderation/fairTurn.js';
import { createMeter, sample } from '../modules/netQuality.js';
import * as J from '../modules/journal.js';
import * as P from '../modules/persist.js';
import crypto from 'crypto';
import { embedAsync, cosine } from '../../../ai-engine/analysis/embed.js';
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
export const SILENCE_MS = 3000, GRACE_MS = 7000, MAX_PARTICIPANTS = 10;
const rooms = new Map(), now = () => Date.now(), rid = () => Math.random().toString(36).slice(2, 10);
export const allRooms = () => [...rooms.values()], getRoom = c => rooms.get(c), drop = r => rooms.delete(r.code);
export const touch = r => { r.v++; r.dirty = r.snapDirty = true; };

export function createRoom({ topic, keywords = [] }, adminId) {
  let code; do code = Math.random().toString(36).slice(2, 6).toUpperCase(); while (code.length < 4 || rooms.has(code));
  const r = { code, topic, keywords, status: 'lobby', participants: new Map(), floor: null, lastActivity: now(), quietUntil: 0, invitedId: null,
    hands: [], feed: [], transcript: [], seq: 0, v: 0, dirty: true, startedAt: null, endedAt: null, report: null, adminOnline: false, topicVecP: embedAsync(topic + ' ' + keywords.join(' ')) };
  rooms.set(code, r); J.log(code, 'room', { topic, keywords }); P.onRoom(r, adminId); return r;
}
export function join(room, id, name, token) {
  let p = id && room.participants.get(id), fresh = null;
  if (p) { if (!token || sha(token) !== p.tokenHash) return null; p.online = true; }            // authenticated reconnect
  else {
    if (room.status === 'ended' || room.participants.size >= MAX_PARTICIPANTS) return null;
    fresh = rid() + rid(); p = { id: rid(), tokenHash: sha(fresh), name, talkMs: 0, turns: 0, invites: 0, lastSpokeAt: 0, transcript: [], online: true, mic: true, cam: true, net: createMeter() };
    room.participants.set(p.id, p); J.log(room.code, 'join', { id: p.id, name }); P.onJoin(room, p);
  }
  touch(room); return { p, token: fresh || token };
}
export function start(room) {
  if (room.status !== 'lobby') return; room.status = 'live'; room.startedAt = room.lastActivity = now(); touch(room); J.log(room.code, 'start'); P.onStart(room);
}
function commit(room) { const p = room.participants.get(room.floor.id); if (p) { p.talkMs += now() - room.floor.since; p.lastSpokeAt = now(); } }
export function speakStart(room, id) {
  const p = room.participants.get(id);
  if (room.status !== 'live' || !p?.online || (room.floor && room.floor.id !== id)) return false;
  if (!room.floor) p.turns++;
  room.floor = { id, since: now() }; room.invitedId = null; room.hands = room.hands.filter(h => h !== id); touch(room); return true;
}
export function speakStop(room, id) {
  if (room.floor?.id !== id) return; commit(room); P.onTalk(room, room.participants.get(id)); room.floor = null; room.lastActivity = now(); touch(room);
}
export function leave(room, id) { // a dropped connection must never leave the floor stuck
  const p = room.participants.get(id); if (!p) return; p.online = false;
  speakStop(room, id); room.hands = room.hands.filter(h => h !== id); if (room.invitedId === id) room.invitedId = null; touch(room);
}
export function raiseHand(room, id) {
  const p = room.participants.get(id);
  if (room.status !== 'live' || !p || room.hands.includes(id) || room.floor?.id === id) return null;
  room.hands.push(id); touch(room); J.log(room.code, 'hand', { id }); return p.name;
}
export function lowerHand(room, id) { room.hands = room.hands.filter(h => h !== id); touch(room); }
export function addSpeech(room, id, text) {
  const p = room.participants.get(id); if (!p || room.status !== 'live' || !text) return;
  const e = { seq: ++room.seq, t: now(), id, name: p.name, text, relevance: 0 };
  p.transcript.push(text); room.transcript.push(e); room.feed.push({ name: p.name, text }); touch(room); J.log(room.code, 'speech', e);
  Promise.all([embedAsync(text), room.topicVecP]).then(([emb, tv]) => { e.relevance = +cosine(emb, tv).toFixed(3); P.onSpeech(room, e, emb); });
}
export function setMedia(room, id, m) { const p = room.participants.get(id); if (p) { p.mic = !!m.mic; p.cam = !!m.cam; touch(room); } }
export function setNet(room, p, s) { const lv = sample(p.net, s); if (lv) touch(room); return lv; }

// Called every 250 ms. Raised hands take priority over the silence rule.
export function tick(room) {
  if (room.status !== 'live' || room.floor) return null;
  const t = now();
  room.hands = room.hands.filter(h => room.participants.get(h)?.online);
  if (room.hands.length) { const h = room.hands[0]; if (room.invitedId !== h) { room.invitedId = h; room.quietUntil = t + 15000; touch(room); } return null; }
  if (t - room.lastActivity < SILENCE_MS || t < room.quietUntil) return null;
  const next = pickNextSpeaker([...room.participants.values()].filter(p => p.online));
  if (!next) return null;
  next.invites++; P.onTalk(room, next); room.invitedId = next.id; room.quietUntil = t + GRACE_MS; room.lastActivity = t; touch(room); return next;
}
export function beginEnd(room) { // idempotent: a double "end" can never run twice
  if (room.status === 'ended') return false;
  if (room.floor) commit(room);
  Object.assign(room, { floor: null, status: 'ended', endedAt: now(), hands: [], invitedId: null }); touch(room); return true;
}
export function finish(room, report) {
  room.report = report; touch(room); P.onEnd(room, report);
  J.finalize(room.code, { topic: room.topic, startedAt: room.startedAt, endedAt: room.endedAt, report, transcript: room.transcript });
}
export function snapshot(room) {
  const t = now(), live = room.status === 'live';
  const total = [...room.participants.values()].reduce((s, p) => s + p.talkMs, 0) || 1;
  return { v: room.v, code: room.code, topic: room.topic, status: room.status, report: room.report, keywords: room.keywords, startedAt: room.startedAt,
    adminOnline: room.adminOnline, invitedId: t < room.quietUntil ? room.invitedId : null, feed: room.feed.slice(-12),
    transcript: room.status === 'ended' ? room.transcript : null, speaker: room.floor?.id || null,
    silentMs: live && !room.floor ? t - room.lastActivity : 0, silenceLimit: SILENCE_MS,
    participants: [...room.participants.values()].map(p => ({ id: p.id, name: p.name, turns: p.turns, invites: p.invites, talkSeconds: Math.round(p.talkMs / 1000),
      share: p.talkMs / total, online: p.online, mic: p.mic, cam: p.cam, q: p.net.level, hand: room.hands.indexOf(p.id) + 1 })) };
}

// Crash recovery: rooms are snapshotted to Redis and rebuilt here (participants come back offline until they reconnect).
export const serialize = r => ({ ...r, topicVecP: undefined, floor: null, participants: [...r.participants.values()] });
export function restore(o) {
  const r = { ...o, participants: new Map(o.participants.map(p => [p.id, { ...p, online: false }])), floor: null, invitedId: null, quietUntil: 0, lastActivity: now(), adminOnline: false, dirty: true, topicVecP: embedAsync(o.topic + ' ' + o.keywords.join(' ')) };
  rooms.set(r.code, r); return r;
}
export function fromDb({ s, ps, us }) { // rebuild an unfinished room from PostgreSQL
  const names = new Map(ps.map(p => [p.pid, p.name]));
  const tr = us.map(u => ({ seq: u.seq, t: +new Date(u.spoken_at), id: u.pid, name: names.get(u.pid) || '?', text: u.text, relevance: u.relevance || 0 }));
  return restore({ code: s.code, topic: s.topic, keywords: s.keywords || [], status: s.status, startedAt: s.started_at ? +new Date(s.started_at) : null, endedAt: null, report: null, hands: [],
    feed: tr.slice(-12).map(x => ({ name: x.name, text: x.text })), transcript: tr, seq: tr.reduce((m, x) => Math.max(m, x.seq), 0), v: 0,
    participants: ps.map(p => ({ id: p.pid, name: p.name, tokenHash: p.token_hash, talkMs: +p.talk_ms, turns: p.turns, invites: p.invites, lastSpokeAt: 0, transcript: tr.filter(x => x.id === p.pid).map(x => x.text), online: false, mic: true, cam: true, net: createMeter() })) });
}
