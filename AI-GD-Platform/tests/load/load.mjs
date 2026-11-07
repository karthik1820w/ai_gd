// Load test: ROOMS x PER participants speaking in turn. Measures floor-grant latency (speak_start -> state shows you as speaker), CPU/RSS, and report completion.
import { execSync } from 'child_process'; import { startServer } from '../integration/helpers.js'; import WebSocket from '../../backend/node_modules/ws/wrapper.mjs';
const ROOMS = +process.env.ROOMS || 30, PER = +process.env.PER || 10, SECS = +process.env.SECS || 30, PORT = 3989, rnd = (a, b) => a + Math.random() * (b - a);
const s = await startServer(PORT, { JOIN_LIMIT: '1000000' });
const { jwt } = await (await fetch(s.url + '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) })).json();
const lat = [], st = { msgs: 0, bytes: 0, errors: 0, contended: 0, reports: 0, grants: 0 }, sockets = [];
const open = () => new Promise(r => { const ws = new WebSocket(`ws://localhost:${PORT}`); sockets.push(ws); ws.on('open', () => r(ws)); ws.on('error', () => st.errors++); });
const upto = (ws, fn) => ws.on('message', d => { st.msgs++; st.bytes += d.length; const m = JSON.parse(d); if (m.type === 'error') st.errors++; fn(m); });
const admins = [];
for (let r = 0; r < ROOMS; r++) {
  const A = await open(); const code = await new Promise(res => { upto(A, m => { if (m.type === 'joined') res(m.code); if (m.type === 'state' && m.state.report && !A.counted) { A.counted = true; st.reports++; } }); A.send(JSON.stringify({ type: 'create', jwt, topic: 'Load room ' + r })); });
  admins.push(A);
  for (let i = 0; i < PER; i++) {
    const ws = await open(); ws.pend = 0;
    upto(ws, m => { if (m.type === 'joined') ws.id = m.id; if (m.type === 'state') { ws.st = m.state; if (ws.pend && m.state.speaker === ws.id) { lat.push(Date.now() - ws.pend); st.grants++; ws.pend = 0; } } });
    ws.send(JSON.stringify({ type: 'join', code, name: 'P' + i }));
    ws.loop = () => { setTimeout(() => { if (ws.st && ws.st.status === 'live' && !ws.st.speaker && !ws.pend) { ws.pend = Date.now(); ws.send(JSON.stringify({ type: 'speak_start' }));
      setTimeout(() => { ws.send(JSON.stringify({ type: 'speech', text: 'Regulation and safety matter for innovation.' })); ws.send(JSON.stringify({ type: 'speak_stop' })); if (ws.pend) { st.contended++; ws.pend = 0; } }, rnd(500, 1200)); } if (!ws.done) ws.loop(); }, rnd(300, 1500)); };
  }
}
await new Promise(r => setTimeout(r, 1500));
for (const A of admins) A.send(JSON.stringify({ type: 'start' }));
const parts = sockets.filter(w => w.loop); parts.forEach(w => w.loop());
const cpu = [], ps = () => execSync(`ps -o %cpu=,rss= -p ${s.pid}`).toString().trim().split(/\s+/).map(Number);
for (let i = 0; i < SECS / 5; i++) { await new Promise(r => setTimeout(r, 5000)); cpu.push(ps()); }
parts.forEach(w => (w.done = true)); admins.forEach(A => A.send(JSON.stringify({ type: 'end' })));
for (let i = 0; i < 100 && st.reports < ROOMS; i++) await new Promise(r => setTimeout(r, 100));
lat.sort((a, b) => a - b); const q = p => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))];
const out = { sockets: sockets.length, seconds: SECS, grants: st.grants, contended: st.contended, p50_ms: q(.5), p95_ms: q(.95), p99_ms: q(.99), max_ms: lat.at(-1), peak_cpu_pct: Math.max(...cpu.map(c => c[0])), peak_rss_mb: Math.round(Math.max(...cpu.map(c => c[1])) / 1024), msgs_per_s: Math.round(st.msgs / SECS), kb_per_s: Math.round(st.bytes / 1024 / SECS), errors: st.errors, reports_ok: `${st.reports}/${ROOMS}` };
console.log(JSON.stringify(out, null, 1)); s.stop(); sockets.forEach(w => w.terminate());
process.exit(out.errors === 0 && st.reports === ROOMS && out.p95_ms < 1000 ? 0 : 1);
