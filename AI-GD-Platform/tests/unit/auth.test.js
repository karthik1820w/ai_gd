import test from 'node:test'; import assert from 'node:assert';
import * as Auth from '../../backend/src/middleware/auth.js';
test('password hashing and JWT round trip', () => {
  const h = Auth.hash('s3cret'); assert.ok(Auth.verify('s3cret', h)); assert.ok(!Auth.verify('wrong', h));
  const t = Auth.sign({ id: 7, email: 'a@b.c' }); assert.equal(Auth.check(t).sub, '7'); assert.equal(Auth.check(t + 'x'), null); assert.equal(Auth.check(''), null);
});
