import test from 'node:test'; import assert from 'node:assert'; import { startServer, client } from './helpers.js';
test('a live room survives a hard server crash (Redis snapshot)', { skip: !process.env.REDIS_URL }, async t => {
  const env = { REDIS_URL: process.env.REDIS_URL }; let s = await startServer(3993, env);
  const { jwt } = await (await fetch(s.url + '/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@example.com', password: 'admin123' }) })).json();
  const A = client(3993); await A.send({ type: 'create', jwt, topic: 'Crash test' }); const { code } = await A.wait(m => m.type === 'joined');
  const P = client(3993); await P.send({ type: 'join', code, name: 'Rohan' }); const j = await P.wait(m => m.type === 'joined');
  await A.send({ type: 'start' }); await P.send({ type: 'speak_start' }); await P.send({ type: 'speech', text: 'Safety matters.' }); await P.send({ type: 'speak_stop' });
  await new Promise(r => setTimeout(r, 1800)); s.stop(); await new Promise(r => setTimeout(r, 300));
  s = await startServer(3993, env); t.after(() => s.stop());
  const P2 = client(3993); await P2.send({ type: 'join', code, id: j.id, token: j.token });
  const st = (await P2.wait(m => m.type === 'state')).state;
  assert.equal(st.status, 'live'); assert.equal(st.feed.length, 1); assert.equal(st.participants[0].name, 'Rohan');
});
