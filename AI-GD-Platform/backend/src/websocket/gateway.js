import { WebSocketServer } from 'ws';
import { evaluateRoom } from '../../../ai-engine/evaluation/evaluate.js';
import * as F from '../services/floorController.js';
import { bucket, take } from '../middleware/rateLimit.js';
import * as Auth from '../middleware/auth.js';
import * as LK from '../modules/livekit.js';
import * as R from '../modules/redis.js';
import * as T from '../modules/transcriber.js';
import * as ICE from '../modules/ice.js';
const TYPES = new Set(['create', 'admin_join', 'join', 'rtc', 'net', 'media', 'hand_raise', 'hand_lower', 'speak_start', 'speak_stop', 'speech', 'start', 'end']);
const num = (x, max) => (Number.isFinite(x) ? Math.max(0, Math.min(max, x)) : null);
const str = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
const NOTICE = { poor: 'Your connection is weak. Video is paused to keep your audio clear.', fair: 'Your connection is unstable.', good: 'Your connection has recovered.' };

export function attach(server) {
  const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
  const socks = new Map(); // room code -> Set<ws>
  const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
  const cast = (code, o, pred = () => true) => socks.get(code)?.forEach(c => pred(c) && send(c, o));
  const claim = (ws, room, role, id) => { // a new socket for the same identity replaces the stale one
    socks.get(room.code)?.forEach(c => { if (c !== ws && c.id === id && c.role === role) { c.replaced = true; c.terminate(); } });
    Object.assign(ws, { room: room.code, role, id });
    if (!socks.has(room.code)) socks.set(room.code, new Set()); socks.get(room.code).add(ws);
    if (role === 'admin') room.adminOnline = true; F.touch(room);
  };
  const flush = room => { if (Date.now() - (room.lastFlush || 0) < 60) return; room.lastFlush = Date.now(); room.dirty = false; cast(room.code, { type: 'state', state: F.snapshot(room) }); };
  const level = (room, p, lv) => {
    if (!lv) return;
    cast(room.code, { type: 'notice', level: lv, text: NOTICE[lv] }, c => c.id === p.id);
    cast(room.code, { type: 'alert', id: p.id, name: p.name, level: lv }, c => c.role === 'admin');
  };

  const lkToken = async (ws, room, id, name, role) => { if (LK.enabled) send(ws, { type: 'lk', url: LK.publicUrl, token: await LK.token(room.code, id, name, role) }); };
  wss.on('connection', (ws, req) => {
    ws.ip = (process.env.TRUST_PROXY && req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress;
    ws.alive = true; ws.bucket = bucket();
    const err = message => send(ws, { type: 'error', message });
    ws.on('pong', () => { // server-side RTT sample, independent of the client's own report
      ws.alive = true; const room = F.getRoom(ws.room), p = room?.participants.get(ws.id);
      if (p && ws.role === 'participant' && Date.now() - p.net.at > 8000) level(room, p, F.setNet(room, p, { rtt: Date.now() - ws.pingAt })); // only when the client's own media-path reports have gone quiet
    });
    ws.on('close', () => {
      const set = socks.get(ws.room); set?.delete(ws); const room = F.getRoom(ws.room);
      if (!room || ws.replaced) return;
      if (ws.role === 'admin') { room.adminOnline = [...set].some(c => c.role === 'admin'); F.touch(room); }
      else if (ws.role === 'participant') F.leave(room, ws.id);
    });
    ws.on('message', async raw => {
      if (!take(ws.bucket)) return err('Slow down.');
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (!m || !TYPES.has(m.type)) return;
      try { await handle(ws, m, err); } catch (e) { console.error('handler error', e); }
    });
  });

  async function handle(ws, m, err) {
    if (m.type === 'create' || m.type === 'admin_join') {
      const adm = Auth.check(m.jwt); if (!adm) return err('Please sign in again.');
      const room = m.type === 'create' ? F.createRoom({ topic: str(m.topic, 200) || 'Open discussion', keywords: (Array.isArray(m.keywords) ? m.keywords : []).slice(0, 20).map(k => str(k, 40)) }, Number(adm.sub)) : F.getRoom(str(m.code, 4));
      if (!room) return err('Room not found.');
      claim(ws, room, 'admin', 'admin');
      send(ws, { type: 'joined', code: room.code, id: 'admin', media: LK.enabled ? 'livekit' : 'mesh' }); send(ws, { type: 'state', state: F.snapshot(room) });
      return lkToken(ws, room, 'admin', 'Host', 'admin');
    }
    if (m.type === 'join') {
      const room = F.getRoom(str(m.code, 4).toUpperCase()); if (!room) return err('Room not found. Check the code.');
      const name = str(m.name, 40); if (!name && !m.id) return err('Please enter your name.');
      if (!(await R.hit('join:' + ws.ip, Number(process.env.JOIN_LIMIT || 30), 60))) return err('Too many attempts. Wait a minute.');
      const j = F.join(room, str(m.id, 16), name, str(m.token, 64)), p = j?.p;
      if (!p) return err(room.status === 'ended' ? 'This discussion has ended.' : 'Could not join (room full or invalid session).');
      claim(ws, room, 'participant', p.id);
      send(ws, { type: 'joined', code: room.code, id: p.id, token: j.token, media: LK.enabled ? 'livekit' : 'mesh', stt: T.enabled ? 'server' : 'browser', ice: ICE.servers(p.id) }); send(ws, { type: 'state', state: F.snapshot(room) });
      return lkToken(ws, room, p.id, p.name, 'participant');
    }
    const room = F.getRoom(ws.room); if (!room) return;
    const p = room.participants.get(ws.id), admin = ws.role === 'admin';
    switch (m.type) {
      case 'rtc': { // signalling relay; never trusts `to` blindly
        const raw = JSON.stringify(m.data || {}); if (raw.length > 16000) return;
        socks.get(room.code)?.forEach(c => c.id === m.to && send(c, { type: 'rtc', from: ws.id, data: m.data })); return;
      }
      case 'start': if (admin) F.start(room); return;
      case 'end': {
        if (!admin || room.status === 'ended') return;
        await T.stop(room);
        if (!F.beginEnd(room)) return;
        F.finish(room, await evaluateRoom(room)); return;
      }
    }
    if (!p || admin) return;
    switch (m.type) {
      case 'net': level(room, p, F.setNet(room, p, { rtt: num(m.rtt, 10000), loss: num(m.loss, 1) })); break;
      case 'media': F.setMedia(room, p.id, m); break;
      case 'speak_start': F.speakStart(room, p.id); break;
      case 'speak_stop': F.speakStop(room, p.id); break;
      case 'speech': F.addSpeech(room, p.id, str(m.text, 500)); break;
      case 'hand_lower': F.lowerHand(room, p.id); break;
      case 'hand_raise': { const who = F.raiseHand(room, p.id); if (who) cast(room.code, { type: 'announce', text: `${who} would like to add something.` }); break; }
    }
    if (['speak_start', 'speak_stop', 'hand_raise', 'hand_lower'].includes(m.type)) flush(room); // floor changes go out immediately (rate-limited); everything else waits for the 250 ms tick
  }

  setInterval(() => wss.clients.forEach(ws => { if (!ws.alive) return ws.terminate(); ws.alive = false; ws.pingAt = Date.now(); ws.ping(); }), 4000); // heartbeat
  let n = 0;
  setInterval(() => { // single coalesced broadcast loop: at most 1 state push per room per 250 ms
    n++;
    for (const room of F.allRooms()) {
      const inv = F.tick(room);
      if (inv) cast(room.code, { type: 'announce', text: `${inv.name}, would you like to share your thoughts?` });
      if (room.status === 'live' && n % 2 === 0) room.dirty = true;
      if (room.dirty) { room.dirty = false; cast(room.code, { type: 'state', state: F.snapshot(room) }); }
      if (room.snapDirty && Date.now() - (room.lastSnap || 0) > 1000) { room.snapDirty = false; room.lastSnap = Date.now(); R.saveSnap(room.code, F.serialize(room)); }
      if (T.enabled && room.status === 'live' && !T.active(room.code)) T.start(room).catch(e => console.error('stt start:', e.message));
      if (LK.enabled && room.status !== 'lobby' && Date.now() > (room.lkRetry || 0)) { // reconcile: only the floor holder may publish audio
        const want = room.status === 'live' ? room.floor?.id || null : null;
        if (room.lkMic !== want) { const old = room.lkMic; room.lkMic = want;
          (async () => { let ok = true; if (old) await LK.allowMic(room.code, old, false); if (want) ok = await LK.allowMic(room.code, want, true); if (!ok) { room.lkMic = old; room.lkRetry = Date.now() + 1000; } })(); }
      }
      if (room.status === 'ended' && room.report && Date.now() - room.endedAt > 3600e3) { F.drop(room); R.dropSnap(room.code); }
    }
  }, 250);
}
