import test from 'node:test'; import assert from 'node:assert';
import { embed, cosine } from '../../ai-engine/analysis/embed.js';
test('on-topic text scores higher than off-topic text', () => {
  const topic = embed('regulation of artificial intelligence bias safety');
  assert.ok(cosine(embed('Regulation reduces bias and improves safety'), topic) > cosine(embed('My favourite pizza has mushrooms'), topic));
  assert.ok(Math.abs(cosine(topic, topic) - 1) < 1e-9);
});
import http from 'http'; import { embedAsync } from '../../ai-engine/analysis/embed.js';
test('external embeddings endpoint is used when valid and ignored when broken', async () => {
  const vec = Array.from({ length: 256 }, (_, i) => (i === 7 ? 3 : 0)); let mode = 'good', seen;
  const srv = http.createServer((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { seen = JSON.parse(b); r.end(JSON.stringify(mode === 'good' ? { data: [{ embedding: vec }] } : { oops: 1 })); }); });
  await new Promise(r => srv.listen(0, r)); process.env.EMBEDDINGS_URL = `http://localhost:${srv.address().port}/v1/embeddings`; process.env.EMBEDDINGS_MODEL = 'm';
  try {
    const v = await embedAsync('hello world'); assert.equal(v[7], 1); assert.equal(seen.dimensions, 256);
    mode = 'bad'; const f = await embedAsync('hello world'); assert.equal(f.length, 256); assert.ok(Math.abs(Math.hypot(...f) - 1) < 1e-9); assert.notEqual(f[7], 1); // hash fallback
  } finally { delete process.env.EMBEDDINGS_URL; srv.close(); }
});
