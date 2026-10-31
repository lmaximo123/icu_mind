'use strict';
// No clinical writes. Optional official Auth login/logout; no credentials logged.
const assert = require('node:assert/strict');
const { createStore } = require('../server/supabase.js');
const { createServer } = require('../server/app.js');
const { createClient } = require('../backend-client.js');
const { once } = require('node:events');
const { signInSynthetic, verifySynthetic, signOutSynthetic } = require('./test-session.js');
const url = 'https://otnwkxchugsovtjdanyu.supabase.co';
let stage = 'configuration';
function assertSignupPolicy(settings) {
  assert.equal(settings.disable_signup, true,
    'Hosted public signup must be disabled. In development project otnwkxchugsovtjdanyu, turn off Auth > Allow new users to sign up; local config.toml does not configure hosted Auth.');
}
function assertInvalidSession(status, body) {
  assert.ok(status === 401 || (status === 403 && body?.error_code === 'bad_jwt'),
    'Malformed JWT must be rejected by Auth (401 or 403 bad_jwt)');
}
async function checkApi(store, token) {
  const server = createServer(store);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/api/units', { signal: AbortSignal.timeout(15000) });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const client = createClient({
      getAccessToken: async () => 'invalid.synthetic.token',
      fetchImpl: (path, options) => fetch(base + path, options)
    });
    await assert.rejects(client.listUnits(), /Osler API request failed \((401|403)\)/);
    if (token) {
      const authenticated = createClient({
        getAccessToken: async () => token,
        fetchImpl: (path, options) => fetch(base + path, options)
      });
      assert.ok(Array.isArray(await authenticated.listUnits()));
    }
  } finally {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  }
}
async function main() {
  assert.equal(process.env.SUPABASE_URL, url, 'Only the Osler synthetic development project is allowed');
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  assert.ok(key, 'SUPABASE_PUBLISHABLE_KEY required');
  const request = (path, token) => fetch(url + path, {
    headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    redirect: 'error', signal: AbortSignal.timeout(10000)
  });
  stage = 'Auth connectivity';
  const settings = await request('/auth/v1/settings');
  assert.equal(settings.status, 200, 'Auth is reachable');
  const authSettings = await settings.json();
  stage = 'hosted signup policy';
  assertSignupPolicy(authSettings);
  stage = 'invalid session';
  const invalidSession = await request('/auth/v1/user', 'invalid.synthetic.token');
  assertInvalidSession(invalidSession.status, await invalidSession.json());
  for (const table of ['units', 'unit_members', 'encounters', 'observation_events']) {
    stage = `anonymous PostgREST ${table}`;
    const response = await request(`/rest/v1/${table}?select=*&limit=1`);
    assert.ok([401, 403].includes(response.status), `Anonymous ${table} access must be denied`);
  }
  console.log('Hosted Auth settings, invalid session and anonymous PostgREST checks passed.');
  let token = process.env.OSLER_TEST_ACCESS_TOKEN;
  let ownsSession = false;
  stage = 'synthetic test login';
  if (!token && (process.env.OSLER_TEST_EMAIL || process.env.OSLER_TEST_PASSWORD)) {
    const password = process.env.OSLER_TEST_PASSWORD;
    delete process.env.OSLER_TEST_PASSWORD;
    token = await signInSynthetic({ key, email: process.env.OSLER_TEST_EMAIL, password });
    ownsSession = true;
  }
  try {
  if (token) {
    stage = 'synthetic identity verification';
    await verifySynthetic({ key, token });
  }
  const store = createStore({ url, key });
  stage = 'browser adapter/local API/hosted Auth';
  await checkApi(store, token);
  console.log('Browser adapter/local API rejects missing and hosted-invalid sessions.');
  if (!token) {
    stage = 'synthetic credentials required';
    if (process.env.OSLER_REQUIRE_AUTH === '1') throw new Error('Synthetic test credentials required');
    console.log('Authenticated checks SKIPPED: supply synthetic credentials; OSLER_REQUIRE_AUTH=1 makes this an error.');
    return;
  }
  stage = 'authenticated Auth/PostgREST';
  await store.authenticate(token);
  assert.ok(Array.isArray(await store.listUnits(token)));
  console.log('Hosted Auth user verification and authenticated PostgREST unit listing passed.');
  } finally {
    if (ownsSession) {
      await signOutSynthetic({ key, token });
      console.log('Synthetic test session signed out (local scope).');
    }
    token = undefined;
  }
}
if (require.main === module) main().catch(() => {
  console.error(`Hosted check failed at: ${stage}. No credentials logged.`);
  if (stage === 'hosted signup policy') {
    console.error('Required: disable public signup in development project otnwkxchugsovtjdanyu Auth settings. Local config.toml does not configure hosted Auth.');
  }
  if (stage === 'synthetic credentials required') {
    console.error('Create the synthetic user in the development dashboard and supply credentials through ignored .env.test; see supabase/README.md.');
  }
  process.exitCode = 1;
});
module.exports = { assertSignupPolicy, assertInvalidSession, checkApi };
