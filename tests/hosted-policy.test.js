'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assertSignupPolicy, assertInvalidSession, checkApi } = require('../scripts/test-hosted.js');
const { ApiError } = require('../server/supabase.js');

test('hosted signup policy requires an explicit disabled signup setting', () => {
  assert.doesNotThrow(() => assertSignupPolicy({ disable_signup: true }));
  for (const disable_signup of [false, undefined, null, 'true', 1]) {
    assert.throws(() => assertSignupPolicy({ disable_signup }), /Hosted public signup must be disabled/);
  }
  // Email verification and disabled anonymous sign-in do not close public signup.
  assert.throws(() => assertSignupPolicy({
    disable_signup: false, mailer_autoconfirm: false, external: { anonymous_users: false }
  }), /Hosted public signup must be disabled/);
});

test('hosted invalid session check accepts explicit Auth rejection and fails closed', () => {
  assert.doesNotThrow(() => assertInvalidSession(401, {}));
  assert.doesNotThrow(() => assertInvalidSession(403, { error_code: 'bad_jwt' }));
  for (const status of [200, 400, 403, 429, 500, 503]) {
    assert.throws(() => assertInvalidSession(status, {}));
  }
  assert.throws(() => assertInvalidSession(403, { error_code: 'unexpected' }));
});

test('integration smoke verifies session before listing units through the browser adapter', async () => {
  let listings = 0;
  await checkApi({
    authenticate: async token => {
      if (token !== 'synthetic.session') throw new ApiError(403, 'Access denied');
    },
    listUnits: async token => {
      assert.equal(token, 'synthetic.session');
      listings++;
      return [];
    }
  }, 'synthetic.session');
  assert.equal(listings, 1);
});
