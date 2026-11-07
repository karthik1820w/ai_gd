import pg from 'pg'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
export const enabled = !!process.env.DATABASE_URL; let pool;
export async function loadOpen() { // unfinished sessions, for recovery when Redis has no snapshot
  if (!enabled) return []; const out = [];
  for (const s of (await q("SELECT code,topic,keywords,status,started_at FROM sessions WHERE status IN ('lobby','live') AND created_at > now() - interval '12 hours'")).rows)
    out.push({ s, ps: (await q('SELECT pid,name,token_hash,talk_ms,turns,invites FROM session_participants WHERE session_code=$1', [s.code])).rows, us: (await q('SELECT pid,seq,text,relevance,spoken_at FROM utterances WHERE session_code=$1 ORDER BY seq', [s.code])).rows });
  return out;
}
export const q = (sql, p) => pool.query(sql, p);
export async function init() { // transactional, ordered, idempotent migration runner
  if (!enabled) return;
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  await q('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY)');
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../database/migrations');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    if ((await q('SELECT 1 FROM schema_migrations WHERE name=$1', [f])).rowCount) continue;
    const c = await pool.connect();
    try { await c.query('BEGIN'); await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); await c.query('INSERT INTO schema_migrations VALUES ($1)', [f]); await c.query('COMMIT'); console.log('migrated', f); }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
}
