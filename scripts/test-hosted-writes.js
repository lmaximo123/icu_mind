'use strict';
// Development-only synthetic writes. Never logs request bodies or Auth material.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { createStore } = require('../server/supabase.js');
const { createServer } = require('../server/app.js');
const { createClient } = require('../backend-client.js');
const { signInSynthetic, verifySynthetic, signOutSynthetic } = require('./test-session.js');
const { assertSignupPolicy } = require('./test-hosted.js');
const fixtures = require('./hosted-fixtures.json');
let stage = 'configuration';

function configuration(env) {
  assert.equal(env.SUPABASE_URL, fixtures.projectUrl);
  assert.equal(env.OSLER_ALLOW_SYNTHETIC_WRITES, '1');
  const key = env.SUPABASE_PUBLISHABLE_KEY;
  // Restrict this runner to the development publishable key, never service_role.
  assert.ok(typeof key === 'string' && key.startsWith('sb_publishable_'));
  const users = [
    { name: 'reader', email: env.OSLER_TEST_EMAIL, password: env.OSLER_TEST_PASSWORD,
      expected: 'osler-synthetic-reader@example.com', unit: fixtures.unitA, role: 'reader' },
    { name: 'clinician A', email: env.OSLER_TEST_CLINICIAN_A_EMAIL, password: env.OSLER_TEST_CLINICIAN_A_PASSWORD,
      expected: 'osler-synthetic-clinician-a@example.com', unit: fixtures.unitA, role: 'clinician' },
    { name: 'clinician B', email: env.OSLER_TEST_CLINICIAN_B_EMAIL, password: env.OSLER_TEST_CLINICIAN_B_PASSWORD,
      expected: 'osler-synthetic-clinician-b@example.com', unit: fixtures.unitB, role: 'clinician' }
  ];
  for (const user of users) {
    assert.equal(user.email, user.expected);
    assert.ok(typeof user.password === 'string' && user.password.length > 0);
  }
  return { key, users };
}

async function denied(operation, status) {
  await assert.rejects(operation, error => error.message === `Osler API request failed (${status})`);
}
function observationTimestamp(startedAt, now = Date.now()) {
  // PostgreSQL has microseconds; Date.parse truncates them. Round above the
  // database's creation instant even when the runner's clock is behind it.
  const start = Date.parse(startedAt);
  assert.ok(Number.isFinite(start));
  return new Date(Math.max(now, start + 1)).toISOString();
}

async function main() {
  const { key, users } = configuration(process.env);
  for (const name of Object.keys(process.env)) {
    if (/^OSLER_TEST.*PASSWORD$/.test(name)) delete process.env[name];
  }
  const sessions = [];
  const created = [];
  const store = createStore({ url: fixtures.projectUrl, key });
  let server;
  async function rest(path, user, method = 'GET', body) {
    return fetch(fixtures.projectUrl + '/rest/v1/' + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { apikey: key, Authorization: `Bearer ${user.token}`,
        'Content-Type': 'application/json', Prefer: 'return=representation' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
  }
  try {
    stage = 'hosted signup policy';
    const settings = await fetch(fixtures.projectUrl + '/auth/v1/settings', {
      headers: { apikey: key }, redirect: 'error', signal: AbortSignal.timeout(10000)
    });
    assert.equal(settings.status, 200);
    assertSignupPolicy(await settings.json());
    for (const user of users) {
      stage = `synthetic login: ${user.name}`;
      user.token = await signInSynthetic({ key, email: user.email, password: user.password });
      user.password = undefined;
      sessions.push(user);
      const identity = await verifySynthetic({ key, token: user.token });
      assert.equal(identity.email, user.expected);
      user.id = identity.id;
    }
    assert.equal(new Set(users.map(user => user.id)).size, 3);
    stage = 'fixture membership preflight';
    for (const user of users) {
      const units = await store.listUnits(user.token);
      assert.equal(units.find(unit => unit.id === user.unit)?.label,
        user.unit === fixtures.unitA ? fixtures.labelA : fixtures.labelB);
      assert.ok(!units.some(unit => unit.id === (user.unit === fixtures.unitA ? fixtures.unitB : fixtures.unitA)));
      const membership = await rest(`unit_members?unit_id=eq.${user.unit}&user_id=eq.${user.id}&select=role`, user);
      assert.equal(membership.status, 200);
      assert.deepEqual(await membership.json(), [{ role: user.role }]);
    }
    server = createServer(store);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const user of users) user.client = createClient({
      getAccessToken: async () => user.token,
      fetchImpl: (path, options) => fetch(base + path, options)
    });
    const [reader, a, b] = users;
    stage = 'synthetic encounter creation';
    for (const user of [a, b]) {
      // Never select or mutate an existing episode. A new UUID is used each run.
      const active = await user.client.listEncounters(user.unit);
      const occupied = new Set(active.filter(row => !row.ended_at).map(row => row.bed_code));
      const bed = Array.from({ length: 1000 }, (_, i) => String(i).padStart(3, '0')).find(code => !occupied.has(code));
      assert.ok(bed);
      const id = randomUUID();
      // Track before sending: a lost response may still have committed the insert.
      created.push({ user, id });
      const rows = await user.client.createEncounter({ id, unit_id: user.unit, bed_code: bed });
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, id);
      assert.equal(rows[0].ended_at, null);
      user.encounter = rows[0];
    }
    stage = 'authenticated observation writes and author binding';
    for (const user of [a, b]) {
      user.event = { id: randomUUID(), encounter_id: user.encounter.id,
        concept: 'ph', value: 7.4, unit: '', confirmed: true, source_type: 'manual',
        timestamp: observationTimestamp(user.encounter.started_at) };
      // A tests two racing first attempts, not only retries of an existing row.
      if (user === a) {
        const firstAttempts = await Promise.all([
          user.client.appendObservation(user.event), user.client.appendObservation(user.event)
        ]);
        assert.deepEqual(firstAttempts[0], firstAttempts[1]);
        user.saved = firstAttempts[0];
      } else {
        user.saved = await user.client.appendObservation(user.event);
      }
      assert.equal(user.saved.id, user.event.id);
      assert.equal(user.saved.recorded_by, user.id);
      assert.equal(user.saved.encounter_id, user.encounter.id);
      assert.equal(Number(user.saved.numeric_value), 7.4);
    }
    stage = 'sequential and concurrent idempotency';
    assert.deepEqual(await a.client.appendObservation(a.event), a.saved);
    const retries = await Promise.all([a.client.appendObservation(a.event), a.client.appendObservation(a.event)]);
    for (const retry of retries) assert.deepEqual(retry, a.saved);
    await denied(() => a.client.appendObservation({ ...a.event, value: 7.5 }), 409);
    assert.deepEqual(await a.client.listObservations(a.encounter.id), [a.saved]);
    console.log('PASS: authenticated writes, author binding, sequential/concurrent retries and conflicting payload.');

    stage = 'bidirectional unit isolation';
    for (const [actor, other] of [[a, b], [b, a]]) {
      assert.deepEqual(await actor.client.listEncounters(other.unit), []);
      assert.deepEqual(await actor.client.listObservations(other.encounter.id), []);
      await denied(() => actor.client.createEncounter({ id: randomUUID(), unit_id: other.unit, bed_code: '999' }), 403);
      await denied(() => actor.client.appendObservation({ ...other.event, id: randomUUID() }), 403);
      assert.deepEqual(await actor.client.closeEncounter(other.encounter.id), []);
      const direct = await rest(`observation_events?encounter_id=eq.${other.encounter.id}&select=id`, actor);
      assert.equal(direct.status, 200);
      assert.deepEqual(await direct.json(), []);
    }
    console.log('PASS: bidirectional read/write/closure isolation across two synthetic units.');

    stage = 'reader access and write denial';
    assert.deepEqual(await reader.client.listObservations(a.encounter.id), [a.saved]);
    await denied(() => reader.client.createEncounter({ id: randomUUID(), unit_id: fixtures.unitA, bed_code: '998' }), 403);
    await denied(() => reader.client.appendObservation({ ...a.event, id: randomUUID() }), 403);
    assert.deepEqual(await reader.client.closeEncounter(a.encounter.id), []);
    assert.deepEqual(await reader.client.listEncounters(fixtures.unitB), []);
    assert.deepEqual(await reader.client.listObservations(b.encounter.id), []);
    for (const user of [a, b]) {
      const rows = await user.client.listEncounters(user.unit);
      assert.equal(rows.find(row => row.id === user.encounter.id)?.ended_at, null);
    }
    console.log('PASS: reader can read its unit but cannot create, append or close episodes.');

    stage = 'direct PostgREST immutability and controlled write path';
    for (const user of [a, reader]) {
      for (const method of ['PATCH', 'DELETE']) {
        const response = await rest(`observation_events?id=eq.${a.event.id}`, user, method,
          method === 'PATCH' ? { numeric_value: 7.5 } : undefined);
        assert.equal(response.status, 403);
      }
      const response = await rest('observation_events', user, 'POST', {
        id: randomUUID(), encounter_id: a.encounter.id, recorded_by: user.id,
        measured_at: a.event.timestamp, concept: 'ph', numeric_value: 7.4, unit: '', source_type: 'manual'
      });
      assert.equal(response.status, 403);
    }
    assert.deepEqual(await a.client.listObservations(a.encounter.id), [a.saved]);
    console.log('PASS: direct event insert/update/delete denied; committed observation unchanged.');

    stage = 'episode closure and post-closure retry';
    for (const user of [a, b]) {
      const closed = await user.client.closeEncounter(user.encounter.id);
      assert.equal(closed.length, 1);
      assert.ok(Date.parse(closed[0].ended_at) >= Date.parse(user.encounter.started_at));
      assert.deepEqual(await user.client.closeEncounter(user.encounter.id), []);
      await denied(() => user.client.appendObservation({ ...user.event, id: randomUUID() }), 422);
      assert.deepEqual(await user.client.appendObservation(user.event), user.saved);
      assert.deepEqual(await user.client.listObservations(user.encounter.id), [user.saved]);
    }
    console.log('PASS: closure, repeat closure, new writes denied after closure, original retries preserved.');
    stage='concurrent append and closure';
    const raceId=randomUUID();
    created.push({user:a,id:raceId});
    const active=await a.client.listEncounters(a.unit);
    const occupied=new Set(active.filter(row=>!row.ended_at).map(row=>row.bed_code));
    const raceBed=Array.from({length:1000},(_,i)=>String(i).padStart(3,'0')).find(code=>!occupied.has(code));
    assert.ok(raceBed);
    const [raceEpisode]=await a.client.createEncounter({id:raceId,unit_id:a.unit,bed_code:raceBed});
    const raceEvent={...a.event,id:randomUUID(),encounter_id:raceId,timestamp:observationTimestamp(raceEpisode.started_at)};
    const [append,closure]=await Promise.allSettled([a.client.appendObservation(raceEvent),a.client.closeEncounter(raceId)]);
    assert.equal(closure.status,'fulfilled');assert.equal(closure.value.length,1);assert.ok(closure.value[0].ended_at);
    const raceRecords=await a.client.listObservations(raceId);
    if(append.status==='fulfilled'){
      assert.deepEqual(raceRecords,[append.value]);assert.deepEqual(await a.client.appendObservation(raceEvent),append.value);
    }else{
      assert.equal(append.reason.message,'Osler API request failed (422)');assert.deepEqual(raceRecords,[]);
    }
    await denied(()=>a.client.appendObservation({...raceEvent,id:randomUUID()}),422);
    console.log('PASS: concurrent append/close has a valid serialized outcome; no partial write and no new post-closure event.');
  } finally {
    // Close only UUIDs generated by this invocation, even after a partial failure.
    const cleanup = await Promise.allSettled(created.map(({ user, id }) => store.closeEncounter(user.token, id)));
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    const logout = await Promise.allSettled(sessions.map(user => signOutSynthetic({ key, token: user.token })));
    for (const user of users) { user.password = undefined; user.token = undefined; }
    if ([...cleanup, ...logout].some(result => result.status === 'rejected')) {
      throw new Error('Synthetic episode closure or session logout failed; inspect synthetic fixtures');
    }
  }
  console.log('Hosted synthetic write security suite passed, including episode closure and session cleanup. Synthetic immutable records retained; no existing data changed.');
}
if (require.main === module) main().catch(() => {
  console.error(`Hosted write check failed at: ${stage}. Credentials and backend details suppressed.`);
  process.exitCode = 1;
});
module.exports = { configuration, denied, observationTimestamp };
