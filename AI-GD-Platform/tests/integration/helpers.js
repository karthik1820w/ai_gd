import { spawn } from 'child_process'; import path from 'path'; import os from 'os'; import fs from 'fs'; import { fileURLToPath } from 'url';
import WebSocket from '../../backend/node_modules/ws/wrapper.mjs';
const backend = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../backend');
export async function startServer(port, env = {}) {
  const p = spawn('node', ['src/server.js'], { cwd: backend, env: { ...process.env, DATABASE_URL: '', REDIS_URL: '', LIVEKIT_URL: '', PORT: String(port), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'gd-')), ...env } });
  await new Promise((ok, no) => { p.stdout.on('data', d => String(d).includes('AI GD Platform on') && ok()); p.on('exit', () => no(new Error('server exited'))); setTimeout(() => no(new Error('server start timeout')), 10000); });
  return { pid: p.pid, url: `http://localhost:${port}`, stop: () => p.kill('SIGKILL') };
}
export function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}`), log = [], ready = new Promise(r => ws.on('open', r)); ws.on('message', d => log.push(JSON.parse(d)));
  return { log, send: async o => { await ready; ws.send(JSON.stringify(o)); }, close: () => ws.close(),
    wait: (pred, ms = 5000) => new Promise((ok, no) => { const t0 = Date.now(), i = setInterval(() => { const m = log.find(pred); if (m) { clearInterval(i); ok(m); } else if (Date.now() - t0 > ms) { clearInterval(i); no(new Error('timeout; last: ' + log.slice(-3).map(x => x.type))); } }, 25); }) };
}
