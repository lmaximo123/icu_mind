'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { createServer } = require('../server/app.js');
const { ApiError } = require('../server/supabase.js');
const { createController } = require('../remote-session.js');
const unit = '20000000-0000-0000-0000-000000000001';
const episode = '30000000-0000-0000-0000-000000000001';
const user = { id: '10000000-0000-0000-0000-000000000001', email: 'osler-synthetic-clinician-a@example.com' };
async function fixture(t, options = {}) {
  const events = new Map(), encounters = [{ id: episode, unit_id: unit, bed_code: '001', started_at: new Date().toISOString(), ended_at: null }];
  const calls = [];
  let lostSave = !!options.lostSave, lostCreate = !!options.lostCreate;
  const store = {
    signIn: async () => ({ access_token: 'synthetic.session', expires_in: 3600, user }),
    signOut: async () => { if (options.logoutFails) throw new ApiError(503, 'Backend unavailable'); return { signed_out: true }; },
    authenticate: async token => { if (token !== 'synthetic.session') throw new ApiError(401, 'Invalid session'); },
    listUnits: async () => [{ id: unit, label: 'Synthetic A' }],
    listEncounters: async () => encounters,
    listObservations: async (_, id) => [...events.values()].filter(row => row.encounter_id === id),
    createEncounter: async (_, body) => {
      const row = { ...body, started_at: new Date().toISOString(), ended_at: null }; encounters.push(row);
      if (lostCreate) { lostCreate = false; throw new ApiError(503, 'Response lost'); }
      return [row];
    },
    closeEncounter: async (_, id) => {
      if (options.closeDenied) return [];
      const row = encounters.find(row => row.id === id);
      if (!row || row.ended_at) return [];
      row.ended_at = new Date().toISOString(); return [row];
    },
    appendObservation: async (_, body) => {
      calls.push(body);
      if (options.reader) throw new ApiError(403, 'Access denied');
      const row = events.get(body.event_id) || { id: body.event_id, encounter_id: body.target_encounter,
        recorded_by: user.id, numeric_value: body.observation_value, unit: body.observation_unit,
        measured_at: body.observation_time, concept: body.observation_concept, source_type: body.observation_source };
      events.set(row.id, row);
      if (lostSave) { lostSave = false; throw new ApiError(503, 'Response lost'); }
      return row;
    }
  };
  const server = createServer(store, { enableRemoteUI: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  let clock = Date.now();
  const controller = createController({ now: () => clock,
    fetchImpl: (path, init) => fetch(`http://127.0.0.1:${server.address().port}` + path, init) });
  t.after(() => controller.dispose());
  const login = () => controller.login(user.email, 'synthetic-password');
  const select = async () => { await controller.selectUnit(unit); await controller.selectEncounter(episode); };
  return { controller, login, select, events, calls, encounters, advance: ms => { clock += ms; } };
}
const input = () => ({ concept: 'ph', value: '7,4', confirmed: true, timestamp: new Date().toISOString(), source_type: 'manual' });
test('login and explicit selection perform no upload; only reviewed manual save writes', async t => {
  const { controller, login, select, calls, events } = await fixture(t);
  await login();
  assert.equal(controller.getState().unitId, '');
  assert.equal(controller.getState().encounterId, '');
  await assert.rejects(controller.save(input()));
  await select();
  assert.equal(calls.length, 0);
  await assert.rejects(controller.save({ ...input(), confirmed: false }));
  assert.equal(calls.length, 0);
  await controller.save(input());
  assert.equal(events.size, 1);
  assert.equal(controller.getState().pending, null);
  assert.match(controller.getState().message, /Gravação confirmada/);
  assert.equal(controller.getState().observations.length, 1);
  assert.ok(!JSON.stringify(controller.getState()).includes('synthetic.session'));
});
test('ambiguous save retains the exact payload and ID, blocks destination changes and safely retries', async t => {
  const { controller, login, select, calls, events } = await fixture(t, { lostSave: true });
  await login(); await select();
  await assert.rejects(controller.save(input()));
  const pending = controller.getState().pending;
  assert.ok(pending);
  assert.equal(controller.getState().savedId, '');
  await assert.rejects(controller.selectUnit(''));
  await controller.save({ ...input(), value: '7.8' });
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(events.size, 1);
  assert.equal(controller.getState().savedId, pending.measurement.id);
});
test('ambiguous encounter creation recovers the original episode without issuing another insert', async t => {
  const { controller, login, encounters } = await fixture(t, { lostCreate: true });
  await login(); await controller.selectUnit(unit);
  await assert.rejects(controller.createEncounter('002'));
  assert.ok(controller.getState().pendingEncounter);
  await controller.createEncounter('003');
  assert.equal(encounters.length, 2);
  assert.equal(encounters[1].bed_code, '002');
  assert.equal(controller.getState().encounterId, encounters[1].id);
  assert.equal(controller.getState().pendingEncounter, null);
});
test('reader rejection and empty close result never display a successful write or closure', async t => {
  const { controller, login, select, events } = await fixture(t, { reader: true, closeDenied: true });
  await login(); await select();
  await assert.rejects(controller.save(input()));
  assert.equal(events.size, 0);
  assert.match(controller.getState().message, /Sem permissão/);
  controller.discardPending();
  await assert.rejects(controller.closeEncounter());
  assert.equal(controller.getState().error, true);
  assert.doesNotMatch(controller.getState().message, /Encerramento confirmado/);
});
test('expired session requires login; retry preserves the pending event through same-user reauthentication', async t => {
  const { controller, login, select, advance, events } = await fixture(t);
  await login(); await select(); advance(3601000);
  await assert.rejects(controller.save(input()));
  assert.equal(controller.getState().expired, true);
  const id = controller.getState().pending.measurement.id;
  await login(); await controller.save();
  assert.equal(events.size, 1);
  assert.equal(controller.getState().savedId, id);
});
test('logout clears remote state even when hosted logout fails; new login has no automatic selection', async t => {
  const { controller, login, select } = await fixture(t, { logoutFails: true });
  await login(); await select(); await controller.logout();
  const state = controller.getState();
  assert.equal(state.user, null); assert.equal(state.encounterId, ''); assert.deepEqual(state.observations, []);
  assert.match(state.message, /não confirmou o logout/);
  await login(); assert.equal(controller.getState().unitId, '');
});
