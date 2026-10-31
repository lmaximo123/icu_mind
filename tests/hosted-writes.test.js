'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { configuration, denied, observationTimestamp } = require('../scripts/test-hosted-writes.js');
const fixtures = require('../scripts/hosted-fixtures.json');
function environment() {
  return {
    SUPABASE_URL: fixtures.projectUrl, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
    OSLER_ALLOW_SYNTHETIC_WRITES: '1', OSLER_TEST_EMAIL: 'osler-synthetic-reader@example.com',
    OSLER_TEST_PASSWORD: 'synthetic-password',
    OSLER_TEST_CLINICIAN_A_EMAIL: 'osler-synthetic-clinician-a@example.com',
    OSLER_TEST_CLINICIAN_A_PASSWORD: 'synthetic-password-a',
    OSLER_TEST_CLINICIAN_B_EMAIL: 'osler-synthetic-clinician-b@example.com',
    OSLER_TEST_CLINICIAN_B_PASSWORD: 'synthetic-password-b'
  };
}
test('hosted write runner refuses other projects, privileged keys and incomplete synthetic accounts', () => {
  assert.equal(configuration(environment()).users.length, 3);
  for (const changes of [
    { SUPABASE_URL: 'https://other-project.supabase.co' },
    { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic' },
    { OSLER_ALLOW_SYNTHETIC_WRITES: undefined },
    { OSLER_TEST_EMAIL: 'real@example.com' },
    { OSLER_TEST_CLINICIAN_A_EMAIL: 'osler-synthetic-reader@example.com' },
    { OSLER_TEST_CLINICIAN_B_PASSWORD: '' }
  ]) assert.throws(() => configuration({ ...environment(), ...changes }));
});
test('write denial assertions distinguish policy rejection from backend outage and unexpected success', async () => {
  await denied(async () => { throw new Error('Osler API request failed (403)'); }, 403);
  await assert.rejects(denied(async () => {}, 403));
  await assert.rejects(denied(async () => { throw new Error('Osler API request failed (503)'); }, 403));
});
test('synthetic measurement follows database microsecond clock when runner clock is behind', () => {
  const start = '2026-10-31T23:43:48.359958+00:00';
  assert.equal(observationTimestamp(start, Date.parse('2026-10-31T23:41:00Z')),
    '2026-10-31T23:43:48.360Z');
  assert.equal(observationTimestamp(start, Date.parse('2026-10-31T23:44:00Z')),
    '2026-10-31T23:44:00.000Z');
  assert.throws(() => observationTimestamp('invalid'));
});
