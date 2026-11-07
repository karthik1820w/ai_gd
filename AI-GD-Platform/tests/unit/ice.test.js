import test from 'node:test'; import assert from 'node:assert'; import crypto from 'crypto';
import * as ICE from '../../backend/src/modules/ice.js';
test('TURN credentials follow the coturn use-auth-secret scheme', () => {
  process.env.TURN_URLS = 'turn:turn.example.com:3478'; process.env.TURN_SECRET = 'topsecret';
  const t = ICE.servers('abc').find(s => s.username), [exp, id] = t.username.split(':');
  assert.equal(id, 'abc'); assert.ok(+exp > Date.now() / 1000);
  assert.equal(t.credential, crypto.createHmac('sha1', 'topsecret').update(t.username).digest('base64'));
  delete process.env.TURN_URLS; assert.equal(ICE.servers('abc').length, 1); // STUN only
});
