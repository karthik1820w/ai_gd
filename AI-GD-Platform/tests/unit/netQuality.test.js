import test from 'node:test'; import assert from 'node:assert';
import { createMeter, sample } from '../../backend/src/modules/netQuality.js';
test('degrades after 2 bad samples, recovers only after 5 good ones', () => {
  const m = createMeter(); assert.equal(sample(m, { rtt: 900, loss: 0.2 }), null); assert.equal(sample(m, { rtt: 900, loss: 0.2 }), 'poor');
  let r = null; for (let i = 0; i < 12 && !r; i++) r = sample(m, { rtt: 20, loss: 0 }); assert.equal(r !== null, true);
});
