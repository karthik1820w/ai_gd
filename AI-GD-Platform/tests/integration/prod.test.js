import test from 'node:test'; import assert from 'node:assert'; import { spawnSync } from 'child_process'; import path from 'path'; import { fileURLToPath } from 'url';
import { createRequire } from 'module'; import { startServer } from './helpers.js';
const cwd = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../backend');
test('production refuses unsafe defaults', () => {
  const r = spawnSync('node', ['src/server.js'], { cwd, timeout: 10000, env: { PATH: process.env.PATH, NODE_ENV: 'production' }, encoding: 'utf8' });
  assert.notEqual(r.status, 0); for (const k of ['JWT_SECRET', 'ADMIN_PASSWORD', 'DATABASE_URL', 'REDIS_URL']) assert.match(r.stderr, new RegExp(k));
});
test('production boots only after default accounts are gone, in a throwaway database', { skip: !(process.env.DATABASE_URL && process.env.REDIS_URL) }, async t => {
  const pg = createRequire(import.meta.url)('../../backend/node_modules/pg'), name = 'gd_t_' + Date.now(), admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await admin.connect(); await admin.query(`CREATE DATABASE ${name}`); const u = new URL(process.env.DATABASE_URL); u.pathname = '/' + name; const dbUrl = u.toString();
  t.after(async () => { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await admin.end(); });
  const prod = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), ADMIN_EMAIL: 'prod@example.com', ADMIN_PASSWORD: 'a-long-admin-password', DATABASE_URL: dbUrl, REDIS_URL: process.env.REDIS_URL };
  (await startServer(3991, { DATABASE_URL: dbUrl })).stop(); await new Promise(r => setTimeout(r, 500)); // dev boot seeds admin@example.com / admin123
  const refused = spawnSync('node', ['src/server.js'], { cwd, timeout: 10000, env: { PATH: process.env.PATH, PORT: '3991', ...prod }, encoding: 'utf8' });
  assert.notEqual(refused.status, 0); assert.match(refused.stderr, /still uses the default password/);
  const c = new pg.Client({ connectionString: dbUrl }); await c.connect(); await c.query("DELETE FROM users WHERE email='admin@example.com'"); await c.end();
  const s = await startServer(3991, prod); t.after(() => s.stop());
  assert.equal(await (await fetch(s.url + '/healthz')).text(), 'ok');
  const post = b => fetch(s.url + '/api/auth/login', { method: 'POST', body: JSON.stringify(b) });
  assert.equal((await post({ email: 'prod@example.com', password: 'a-long-admin-password' })).status, 200); assert.equal((await post({ email: 'admin@example.com', password: 'admin123' })).status, 401);
});
