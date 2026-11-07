// Redis: cross-instance rate limiting + hot room snapshots for crash recovery. Falls back to in-memory when REDIS_URL is unset.
import { createClient } from 'redis';
export const enabled = !!process.env.REDIS_URL; let c; const mem = new Map();
export async function init() { if (!enabled) return; c = createClient({ url: process.env.REDIS_URL, socket: { reconnectStrategy: n => (n > 3 ? new Error('Redis unreachable') : 300) } }); c.on('error', e => console.error('redis:', e.message)); await c.connect(); }
export async function hit(key, limit, sec) { // fixed-window counter
  if (!c) { const n = Date.now(), e = mem.get(key); if (!e || e.t < n) { mem.set(key, { t: n + sec * 1000, n: 1 }); return true; } return ++e.n <= limit; }
  const n = await c.incr('rl:' + key); if (n === 1) await c.expire('rl:' + key, sec); return n <= limit;
}
export const saveSnap = (code, obj) => c?.set('snap:' + code, JSON.stringify(obj), { EX: 3600 }).catch(e => console.error('redis:', e.message));
export const dropSnap = code => c?.del('snap:' + code);
export async function loadSnaps() { const out = []; if (!c) return out; for await (const k of c.scanIterator({ MATCH: 'snap:*', COUNT: 100 })) { const s = await c.get(k); if (s) out.push(JSON.parse(s)); } return out; }
