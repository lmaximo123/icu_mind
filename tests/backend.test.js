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
test('engine snapshot is authenticated, strictly scoped and schema-validated without writes',async t=>{
 const calls=[];const {call}=await fixture(t,{engineSnapshot:async(token,body)=>{calls.push({token,body});return {complete:true};}});
 const body={unit_id:id,encounter_id:id,window_start:'2026-01-01T00:00:00Z',window_end:'2026-01-02T00:00:00Z'};
 assert.equal((await call('/api/engine/snapshot',body,{Authorization:''})).status,401);
 for(const invalid of [{...body,user_id:id},{...body,window_end:'2026-01-01'},{...body,window_end:'2026-03-01T00:00:00Z'},{...body,unit_id:'bad'}])assert.ok([400,422].includes((await call('/api/engine/snapshot',invalid)).status));
 const response=await call('/api/engine/snapshot',body);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(calls.length,1);assert.equal(calls[0].body.target_unit,id);assert.equal(calls[0].token,'synthetic.session');
});
test('document API uses reviewed scalar schema, rejects image/unknown provenance, preserves JWT and sanitizes reader denial (mock store)',async t=>{
 const {row}=require('./fixtures/document-fixture.js');const calls=[];
 const {call}=await fixture(t,{appendDocumentObservation:async(token,body)=>{calls.push({token,body});return {event:{id:body.event_id},source:body.source};}});
 const body=row();const response=await call('/api/document-observations',body);assert.equal(response.status,200);assert.equal(calls[0].token,'synthetic.session');assert.equal(calls[0].body.target_unit,body.unit_id);
 assert.equal((await call('/api/document-observations',{...body,image:'data:image/png;base64,forbidden'})).status,400);
 assert.equal((await call('/api/document-observations',{...body,source:{...body.source,image:'forbidden'}})).status,422);
 assert.equal((await call('/api/document-observations',{...body,timestamp:null})).status,422);assert.equal(calls.length,1);
 const denied=await fixture(t,{appendDocumentObservation:async()=>{throw new ApiError(403,'provider details suppressed');}});const forbidden=await denied.call('/api/document-observations',body);assert.equal(forbidden.status,403);assert.ok(!(await forbidden.text()).includes('provider details'));
});
test('development server serves existing app assets under one origin and hides private files', async t => {
  const { base } = await fixture(t, {}, { staticRoot: require('node:path').resolve(__dirname, '..') });
  const page = await fetch(base + '/');
  assert.equal(page.status, 200); assert.match(await page.text(), /Osler \|/);
  for (const file of ['app.js', 'score-ui.js', 'clinical-scores.js', 'osler-validation.js', 'osler-logo.svg', 'backend-client.js', 'remote-session.js', 'remote-ui.js', 'clinical-engine.js', 'remote-engine-ui.js', 'engine-review.js','local-ocr.js','document-review.js','document-ui.js','synthetic-images.js']) {
    const asset = await fetch(base + '/' + file);
    assert.equal(asset.status, 200); assert.ok((await asset.text()).length > 0);
  }
  for (const path of ['/.env', '/server/index.js', '/ICU-Mind-Vercel-pronto.zip', '/.git/config']) {
    assert.equal((await fetch(base + path)).status, 401);
  }
});
test('development login routes are opt-in, synthetic-only, same-origin and never accept extra fields', async t => {
  const disabled = await fixture(t);
  assert.deepEqual(await (await disabled.call('/api/auth/config')).json(), { enabled: false });
  assert.equal((await disabled.call('/api/auth/login', { email: 'osler-synthetic-reader@example.com', password: 'synthetic' })).status, 404);
  let logins = 0;
  const enabled = await fixture(t, {
    signIn: async () => { logins++; return { access_token: 'synthetic.session', expires_in: 3600, user: { id } }; },
    signOut: async () => ({ signed_out: true })
  }, { enableRemoteUI: true });
  const credentials = { email: 'osler-synthetic-reader@example.com', password: 'synthetic' };
  assert.equal((await enabled.call('/api/auth/login', { ...credentials, extra: 'forbidden' })).status, 400);
  assert.equal((await enabled.call('/api/auth/login', { ...credentials, email: 'real@example.com' })).status, 400);
  assert.equal((await enabled.call('/api/auth/login', credentials, { Origin: 'https://other.example.com' })).status, 403);
  const response = await enabled.call('/api/auth/login', credentials, { Authorization: '' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(logins, 1);
  assert.equal((await enabled.call('/api/auth/logout', undefined, { Authorization: '' })).status, 401);
  assert.equal((await enabled.call('/api/auth/logout', {})).status, 200);
});
test('Auth adapter uses official password grant, strips refresh tokens and supports 204 logout', async () => {
  const requests = [];
  const email = 'osler-synthetic-reader@example.com';
  const store = createStore({ url: 'https://otnwkxchugsovtjdanyu.supabase.co', key: 'sb_publishable_synthetic',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return url.pathname.endsWith('/logout') ? new Response(null, { status: 204 }) :
        Response.json({ access_token: 'synthetic.session', refresh_token: 'never-forward-this', expires_in: 3600,
          user: { id, email, user_metadata: { private: 'omit' } } });
    } });
  const session = await store.signIn(email, 'synthetic-password');
  assert.deepEqual(session, { access_token: 'synthetic.session', expires_in: 3600, user: { id, email } });
  assert.equal(requests[0].url.pathname, '/auth/v1/token');
  assert.equal(requests[0].url.search, '?grant_type=password');
  assert.equal(requests[0].options.headers.Authorization, undefined);
  assert.deepEqual(await store.signOut(session.access_token), { signed_out: true });
  assert.equal(requests[1].url.search, '?scope=local');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer synthetic.session');
  const wrongProject = createStore({ url: 'https://other.supabase.co', key: 'sb_publishable_synthetic' });
  await assert.rejects(wrongProject.signIn(email, 'synthetic-password'), error => error.status === 403);
});
test('Auth credential rejection hides provider details and outages remain failures', async () => {
  for (const [status, expected] of [[400, 401], [422, 401], [403, 401], [500, 503]]) {
    const store = createStore({ url: 'https://otnwkxchugsovtjdanyu.supabase.co', key: 'sb_publishable_synthetic',
      fetchImpl: async () => new Response('private provider error and credentials', { status }) });
    await assert.rejects(store.signIn('osler-synthetic-reader@example.com', 'synthetic-password'),
      error => error.status === expected && !error.message.includes('private') && !error.message.includes('synthetic-password'));
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
