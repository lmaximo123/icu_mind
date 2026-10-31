'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../server/app.js');
const { createStore, ApiError } = require('../server/supabase.js');
const { createClient } = require('../backend-client.js');
const id = '30000000-0000-0000-0000-000000000001';
const event = { id: '40000000-0000-0000-0000-000000000001', encounter_id: id,
  concept: 'ph', value: 7.4, unit: '', confirmed: true,
  timestamp: new Date().toISOString(), source_type: 'manual' };
async function fixture(t, overrides = {}, options = {}) {
  const calls = [];
  const store = {
    authenticate: async token => { if (token !== 'synthetic.session') throw new ApiError(401, 'Invalid session'); },
    appendObservation: async (token, body) => { calls.push(body); return { id: body.event_id }; },
    listUnits: async () => [{ id, label: 'Synthetic unit' }],
    listEncounters: async () => [], createEncounter: async (_, body) => [body],
    closeEncounter: async () => [], listObservations: async () => [], ...overrides
  };
  const server = createServer(store, options);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, body, headers = {}) => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer synthetic.session', 'Content-Type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  return { call, calls, base };
}
test('API requires a verified session and disables response caching', async t => {
  const { call } = await fixture(t);
  const response = await call('/api/observations?encounter_id=' + id, undefined, { Authorization: '' });
  assert.equal(response.status, 401); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  assert.equal((await call('/api/encounters?unit_id=' + id, undefined, { Authorization: 'Bearer expired' })).status, 401);
});
test('development server serves existing app assets under one origin and hides private files', async t => {
  const { base } = await fixture(t, {}, { staticRoot: require('node:path').resolve(__dirname, '..') });
  const page = await fetch(base + '/');
  assert.equal(page.status, 200); assert.match(await page.text(), /Osler \|/);
  for (const file of ['app.js', 'score-ui.js', 'clinical-scores.js', 'osler-validation.js', 'osler-logo.svg', 'backend-client.js']) {
    const asset = await fetch(base + '/' + file);
    assert.equal(asset.status, 200); assert.ok((await asset.text()).length > 0);
  }
  for (const path of ['/.env', '/server/index.js', '/ICU-Mind-Vercel-pronto.zip', '/.git/config']) {
    assert.equal((await fetch(base + path)).status, 401);
  }
});
test('API writes confirmed data using authenticated RPC, preserving retry ID', async t => {
  const { call, calls } = await fixture(t);
  assert.equal((await call('/api/observations', event)).status, 200);
  assert.equal((await call('/api/observations', event)).status, 200);
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0].event_id, event.id); assert.equal(calls[0].observation_unit, '');
  assert.equal(Object.hasOwn(calls[0], 'recorded_by'), false);
});
test('API blocks unconfirmed, malformed, wrong-unit, nonnumeric and out-of-range records', async t => {
  const { call, calls } = await fixture(t);
  for (const change of [{ confirmed: false }, { unit: '%' }, { value: 9 }, { value: null },
    { concept: 'toString' }, { timestamp: '2026-10-31' }, { timestamp: 'bad' },
    { source_type: 'unreviewed' }, { concept: 'unknown' }]) {
    assert.equal((await call('/api/observations', { ...event, ...change })).status, 422);
  }
  assert.equal((await call('/api/observations', { ...event, recorded_by: id })).status, 400);
  assert.equal((await call('/api/observations', { ...event, encounter_id: 'bad' })).status, 400);
  assert.equal(calls.length, 0);
});
test('API bounds requests and rejects invalid JSON and media types', async t => {
  const { base, call, calls } = await fixture(t);
  assert.equal((await call('/api/observations', event, { 'Content-Type': 'text/plain' })).status, 415);
  const headers = { Authorization: 'Bearer synthetic.session', 'Content-Type': 'application/json' };
  assert.equal((await fetch(base + '/api/observations', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await call('/api/observations', { ...event, extra: 'x'.repeat(17000) })).status, 413);
  assert.equal(calls.length, 0);
});
test('encounter routes validate IDs and do not accept ownership or timestamps from callers', async t => {
  const { call } = await fixture(t);
  assert.equal((await call('/api/encounters?unit_id=' + id)).status, 200);
  assert.equal((await call('/api/encounters?unit_id=bad')).status, 400);
  assert.equal((await call('/api/encounters', { id, unit_id: id, bed_code: '01' })).status, 200);
  assert.equal((await call('/api/encounters', { id, unit_id: id, bed_code: '01', started_at: 'bad' })).status, 400);
  assert.equal((await call(`/api/encounters/${id}/close`, {})).status, 200);
});
test('API hides unexpected backend errors and secrets', async t => {
  const { call } = await fixture(t, { listEncounters: async () => { throw new Error('sensitive internal detail'); } });
  const response = await call('/api/encounters?unit_id=' + id);
  assert.equal(response.status, 500); assert.deepEqual(await response.json(), { error: 'Internal error' });
});
test('Supabase adapter forwards user JWT, never substitutes privileged credentials', async () => {
  const requests = [];
  const store = createStore({ url: 'https://synthetic.supabase.co', key: 'synthetic-publishable',
    fetchImpl: async (url, options) => { requests.push({ url, options }); return Response.json({ id }); } });
  await store.authenticate('synthetic.session');
  await store.appendObservation('synthetic.session', { event_id: event.id });
  assert.equal(requests[0].url.pathname, '/auth/v1/user');
  assert.equal(requests[1].url.pathname, '/rest/v1/rpc/append_observation');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer synthetic.session');
  assert.equal(requests[1].options.headers.apikey, 'synthetic-publishable');
  assert.equal(requests[1].options.redirect, 'error');
});
test('Supabase errors and network failures are sanitized and fail closed', async () => {
  for (const [status, expected] of [[401, 401], [403, 403], [409, 409], [400, 422], [422, 422], [500, 503]]) {
    const store = createStore({ url: 'https://synthetic.supabase.co', key: 'synthetic',
      fetchImpl: async () => new Response('private database error', { status }) });
    await assert.rejects(store.authenticate('synthetic.session'), e => e.status === expected && !e.message.includes('private'));
  }
  const store = createStore({ url: 'https://synthetic.supabase.co', key: 'synthetic', fetchImpl: async () => { throw Error('private'); } });
  await assert.rejects(store.authenticate('synthetic.session'), e => e.status === 503);
  assert.throws(() => createStore({ url: 'http://synthetic.supabase.co', key: 'synthetic' }));
});
test('browser adapter exercises HTTP API and never silently saves after failure', async t => {
  const { base, calls } = await fixture(t);
  let token = 'synthetic.session';
  const client = createClient({ getAccessToken: async () => token,
    fetchImpl: (path, options) => fetch(base + path, options) });
  assert.deepEqual(await client.listUnits(), [{ id, label: 'Synthetic unit' }]);
  assert.deepEqual(await client.appendObservation(event), { id: event.id });
  assert.deepEqual(await client.listEncounters(id), []);
  assert.deepEqual(await client.listObservations(id), []);
  token = '';
  await assert.rejects(client.appendObservation(event), /Session required/);
  token = 'expired';
  await assert.rejects(client.appendObservation(event), /401/);
  assert.equal(calls.length, 1);
});
