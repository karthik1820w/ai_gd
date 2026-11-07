import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import * as Auth from '../middleware/auth.js'; import * as R from '../modules/redis.js'; import * as db from '../modules/db.js'; import * as F from '../services/floorController.js';
const here = path.dirname(fileURLToPath(import.meta.url)), page = path.join(here, '../../../frontend/index.html'), lkJs = path.join(here, '../../node_modules/livekit-client/dist/livekit-client.umd.js');
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); return true; };
const body = req => new Promise((ok, no) => { let s = ''; req.on('data', c => { s += c; if (s.length > 2048) { no(new Error('big')); req.destroy(); } }); req.on('end', () => { try { ok(JSON.parse(s || '{}')); } catch (e) { no(e); } }); });
export async function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/healthz') { res.end('ok'); return true; }
  if (u.pathname === '/vendor/livekit-client.umd.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'public,max-age=86400' }); fs.createReadStream(lkJs).pipe(res); return true; }
  if (req.method === 'POST' && u.pathname === '/api/auth/login') {
    if (!(await R.hit('login:' + req.socket.remoteAddress, 10, 60))) return json(res, 429, { error: 'Too many attempts. Try again in a minute.' });
    try { const b = await body(req), user = await Auth.login(String(b.email || ''), String(b.password || '')); return user ? json(res, 200, { jwt: Auth.sign(user) }) : json(res, 401, { error: 'Invalid email or password.' }); }
    catch { return json(res, 400, { error: 'Bad request.' }); }
  }
  if (u.pathname === '/api/sessions') {
    const a = Auth.check((req.headers.authorization || '').slice(7)); if (!a) return json(res, 401, { error: 'Unauthorized.' });
    const rows = db.enabled ? (await db.q('SELECT code,topic,status,created_at,ended_at FROM sessions WHERE admin_id=$1 ORDER BY created_at DESC LIMIT 50', [a.sub])).rows : F.allRooms().map(r => ({ code: r.code, topic: r.topic, status: r.status }));
    return json(res, 200, { sessions: rows });
  }
  if ((u.pathname === '/' || u.pathname === '/index.html') && !fs.existsSync(page)) return json(res, 404, { error: 'Frontend not bundled; this is the API/WebSocket server.' });
  if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'content-type': 'text/html' }); fs.createReadStream(page).pipe(res); return true; }
  res.writeHead(404); res.end('Not found'); return true;
}
