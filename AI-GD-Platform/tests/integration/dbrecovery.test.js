import test from 'node:test'; import assert from 'node:assert'; import { startServer, client } from './helpers.js';
test('a live room is rebuilt from PostgreSQL when Redis has nothing', { skip: !process.env.DATABASE_URL }, async t => {
  const env = { DATABASE_URL: process.env.DATABASE_URL, REDIS_URL: '', JWT_SECRET: 'x'.repeat(40) }; let s = await startServer(3992, env);
  const { jwt } = await (await fetch(s.url + '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) })).json();
  const A = client(3992); await A.send({ type: 'create', jwt, topic: 'DB recovery' }); const { code } = await A.wait(m => m.type === 'joined');
  const P = client(3992); await P.send({ type: 'join', code, name: 'Isha' }); const j = await P.wait(m => m.type === 'joined');
  await A.send({ type: 'start' }); await P.send({ type: 'speak_start' }); await P.send({ type: 'speech', text: 'Safety matters most.' }); await P.send({ type: 'speak_stop' });
  await new Promise(r => setTimeout(r, 1500)); s.stop(); await new Promise(r => setTimeout(r, 300));
  s = await startServer(3992, env); t.after(() => s.stop());
  const P2 = client(3992); await P2.send({ type: 'join', code, id: j.id, token: j.token });
  const st = (await P2.wait(m => m.type === 'state')).state;
  assert.equal(st.status, 'live'); assert.equal(st.feed[0].text, 'Safety matters most.'); assert.equal(st.participants[0].name, 'Isha'); assert.equal(st.participants[0].turns, 1);
  const A2 = client(3992); await A2.send({ type: 'admin_join', jwt, code }); await A2.wait(m => m.type === 'joined'); await A2.send({ type: 'end' }); await A2.wait(m => m.type === 'state' && m.state.report);
  const bad = client(3992); await bad.send({ type: 'join', code, id: j.id, token: 'forged' }); await bad.wait(m => m.type === 'error'); // token hash survived the restart
});
