import test from 'node:test'; import assert from 'node:assert'; import { startServer, client } from './helpers.js';
const post = (u, b) => fetch(u + '/api/auth/login', { method: 'POST', body: JSON.stringify(b) });
test('full discussion lifecycle over WebSocket', async t => {
  const s = await startServer(3994); t.after(() => s.stop());
  assert.equal((await post(s.url, { email: 'admin@example.com', password: 'nope' })).status, 401);
  const { jwt } = await (await post(s.url, { email: 'admin@example.com', password: 'admin123' })).json(); assert.ok(jwt);
  const anon = client(3994); await anon.send({ type: 'create', jwt: 'forged', topic: 't' });
  assert.equal((await anon.wait(m => m.type === 'error')).message, 'Please sign in again.');
  const A = client(3994); await A.send({ type: 'create', jwt, topic: 'Regulation of AI', keywords: ['regulation'] }); const { code } = await A.wait(m => m.type === 'joined');
  const P1 = client(3994), P2 = client(3994);
  await P1.send({ type: 'join', code, name: 'Aarav' }); await P2.send({ type: 'join', code, name: 'Meera' });
  const j1 = await P1.wait(m => m.type === 'joined'); await P2.wait(m => m.type === 'joined');
  await A.send({ type: 'start' }); await P1.wait(m => m.type === 'state' && m.state.status === 'live');
  await P1.send({ type: 'speak_start' }); await P1.send({ type: 'speech', text: 'Regulation protects people from bias.' }); await P1.send({ type: 'speak_stop' });
  await P2.send({ type: 'hand_raise' });
  assert.match((await P2.wait(m => m.type === 'announce')).text, /Meera would like to add something/);
  await A.send({ type: 'end' });
  const end = await A.wait(m => m.type === 'state' && m.state.report);
  assert.equal(end.state.transcript.length, 1); assert.equal(end.state.transcript[0].name, 'Aarav'); assert.ok(end.state.transcript[0].relevance > 0);
  const bad = client(3994); await bad.send({ type: 'join', code, id: j1.id, token: 'wrong' }); await bad.wait(m => m.type === 'error');
  const good = client(3994); await good.send({ type: 'join', code, id: j1.id, token: j1.token }); await good.wait(m => m.type === 'joined'); // authenticated reconnect
});
