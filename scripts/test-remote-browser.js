'use strict';
// Opt-in real Chromium + real development Auth/API. Never prints CDP payloads.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createServer } = require('../server/app.js');
const { createStore, ApiError } = require('../server/supabase.js');
const { configuration } = require('./test-hosted-writes.js');
const { assertSignupPolicy } = require('./test-hosted.js');
const fixtures = require('./hosted-fixtures.json');
let stage = 'configuration';
async function until(check, milliseconds = 20000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('Browser condition timed out');
}
async function main() {
  const { key, users } = configuration(process.env);
  const settings = await fetch(fixtures.projectUrl + '/auth/v1/settings', {
    headers: { apikey: key }, redirect: 'error', signal: AbortSignal.timeout(10000)
  });
  assert.equal(settings.status, 200); assertSignupPolicy(await settings.json());
  const store = createStore({ url: fixtures.projectUrl, key });
  const created = [];
  const sessionTokens = new Set();
  const sessionsByEmail = new Map();
  let activeUser;
  let writes = 0, loseResponse = true;
  const wrappedStore = { ...store,
    signIn: async (...args) => {
      const session = await store.signIn(...args);
      sessionTokens.add(session.access_token); sessionsByEmail.set(session.user.email, session.access_token); return session;
    },
    signOut: async token => { const result = await store.signOut(token); sessionTokens.delete(token); return result; },
    createEncounter: async (token, body) => {
      if (![fixtures.unitA, fixtures.unitB].includes(body.unit_id)) throw new Error('Fixture units only');
      const rows = await store.createEncounter(token, body);
      created.push({ token, id: body.id }); return rows;
    },
    appendObservation: async (token, body) => {
      assert.ok(created.some(row => row.id === body.target_encounter));
      writes++;
      const row = await store.appendObservation(token, body);
      if (loseResponse) { loseResponse = false; throw new ApiError(503, 'Synthetic lost response'); }
      return row;
    }
  };
  const server = createServer(wrappedStore, { staticRoot: path.resolve(__dirname, '..'), enableRemoteUI: true });
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'osler-ui-test-'));
  let chrome, socket;
  const pending = new Map();
  let sequence = 0, targetSession;
  function send(method, params = {}, sessionId = targetSession) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout')); }, 20000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error('Browser evaluation failed');
    return result.result.value;
  }
  const waitFor = expression => until(async () => {
    try { return await evaluate(expression); } catch { return false; } // Reload can replace the execution context between polls.
  });
  async function change(id, value) {
    await evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  async function login(user) {
    await change('remote-email', user.email); await change('remote-password', user.password);
    await click('remote-login-button');
    await waitFor(`!document.getElementById('remote-workspace').hidden && !document.getElementById('remote-refresh').disabled`);
    assert.equal(await evaluate(`document.getElementById('remote-password').value`), '');
    activeUser = user;
  }
  async function logout() {
    await click('remote-logout');
    await waitFor(`document.getElementById('remote-account').hidden && !document.getElementById('remote-login-button').disabled`);
    activeUser = null;
  }
  async function selectUnit(id) {
    await change('remote-unit', id);
    await waitFor(`!document.getElementById('remote-encounter').disabled`);
  }
  async function selectEpisode(id) {
    await change('remote-encounter', id);
    await waitFor(`!document.getElementById('remote-refresh').disabled && document.getElementById('remote-status').textContent.includes('Episódio selecionado')`);
  }
  async function browserApi(endpoint, method = 'GET', body) {
    assert.ok(activeUser);
    // Reuse the session created by this user's real UI login, in memory only.
    // The CDP expression and response bodies are never logged.
    assert.ok(endpoint.startsWith('/api/encounters') || endpoint.startsWith('/api/observations'));
    const init = { method, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${sessionsByEmail.get(activeUser.email)}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}) };
    return evaluate(`fetch(${JSON.stringify(endpoint)},${JSON.stringify(init)}).then(async r=>({status:r.status,body:await r.json()}))`);
  }
  const visibleHistory = () => evaluate(`Array.from(document.getElementById('remote-history').children).map(row=>row.textContent).sort()`);
  async function saveReviewed(value) {
    await change('remote-value', value);
    await evaluate(`document.getElementById('remote-confirm').checked=true`);
    await click('remote-save');
    await waitFor(`document.getElementById('remote-status').textContent.includes('Gravação confirmada') && !document.getElementById('remote-save').disabled`);
  }
  async function assertIsolation(otherUnit, otherEpisode, sample) {
    const episodes = await browserApi('/api/encounters?unit_id=' + otherUnit);
    assert.equal(episodes.status, 200); assert.deepEqual(episodes.body, []);
    const observations = await browserApi('/api/observations?encounter_id=' + otherEpisode);
    assert.equal(observations.status, 200); assert.deepEqual(observations.body, []);
    assert.equal((await browserApi('/api/encounters', 'POST', {
      id: randomUUID(), unit_id: otherUnit, bed_code: '989'
    })).status, 403);
    assert.equal((await browserApi('/api/observations', 'POST', {
      id: randomUUID(), encounter_id: otherEpisode, concept: 'ph', value: 7.4,
      unit: '', timestamp: sample.measured_at, confirmed: true, source_type: 'manual'
    })).status, 403);
    const close = await browserApi('/api/encounters/' + otherEpisode + '/close', 'POST', {});
    assert.equal(close.status, 200); assert.deepEqual(close.body, []);
  }
  const localDrafts = () => evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('icu-mind-local');r.onerror=()=>reject();r.onsuccess=()=>{const db=r.result;const q=db.transaction('beds','readonly').objectStore('beds').getAll();q.onsuccess=()=>{db.close();resolve(JSON.stringify(q.result));};q.onerror=()=>{db.close();reject();};};})`);
  function checkDrafts(actual, expected) {
    function changes(a, b, prefix = '') {
      if (a === b) return [];
      if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return [prefix];
      return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap(key => changes(a[key], b[key], prefix + '/' + key));
    }
    if (actual !== expected) console.log('Changed local schema paths (values suppressed): ' + changes(JSON.parse(actual), JSON.parse(expected)).join(', '));
    assert.equal(actual, expected);
  }
  try {
    stage = 'browser startup';
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const chromePath = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
    chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    let spawnFailed = false; chrome.on('error', () => { spawnFailed = true; });
    let portInfo;
    await until(async () => {
      if (spawnFailed) throw new Error('Chromium unavailable');
      try { portInfo = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n'); return true; } catch { return false; }
    });
    socket = new WebSocket(`ws://127.0.0.1:${portInfo[0]}${portInfo[1]}`);
    await once(socket, 'open');
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const call = pending.get(message.id); clearTimeout(call.timeout); pending.delete(message.id);
        if (message.error) call.reject(new Error('CDP operation failed')); else call.resolve(message.result);
      }
      if (message.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    });
    const target = await send('Target.createTarget', { url: 'about:blank' }, null);
    const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null);
    targetSession = attached.sessionId;
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    // Vendor OCR/icons/styles are outside this focused API smoke check.
    await send('Network.setBlockedURLs', { urls: ['*cdn.tailwindcss.com*', '*unpkg.com*', '*cdn.jsdelivr.net*'] });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    await waitFor(`!!document.getElementById('remote-content') && !document.getElementById('remote-content').hidden && document.getElementById('persistence-status').textContent.includes('navegador')`);
    await evaluate(`document.getElementById('remote-panel').open=true`);
    await change('manual-text-input', 'Rascunho sintético local que não deve ser enviado.');
    // Wait for the existing asynchronous score calculation and draft write too.
    await until(async () => JSON.parse(await localDrafts()).some(row => row.data?.scoreText?.includes('Rascunho sintético local')));
    const draftsBefore = await localDrafts();
    stage = 'browser login and explicit selection';
    await login(users[1]);
    assert.equal(await evaluate(`document.getElementById('remote-unit').value`), '');
    assert.equal(await evaluate(`document.getElementById('remote-encounter').value`), '');
    await change('remote-unit', fixtures.unitA);
    await waitFor(`!document.getElementById('remote-bed').disabled`);
    assert.equal(writes, 0);
    const existing = await evaluate(`Array.from(document.getElementById('remote-encounter').options).filter(o=>o.textContent.includes('aberto')).map(o=>o.textContent).join(' ')`);
    const bed = ['991','992','993','994','995','996'].find(code => !existing.includes('Leito ' + code));
    assert.ok(bed);
    await change('remote-bed', bed); await click('remote-create-button');
    await waitFor(`document.getElementById('remote-status').textContent.includes('Novo episódio confirmado')`);
    const encounterId = await evaluate(`document.getElementById('remote-encounter').value`);
    assert.ok(encounterId);
    assert.equal(writes, 0);
    stage = 'browser reviewed write with lost response and explicit retry';
    await change('remote-value', '7,4');
    await evaluate(`document.getElementById('remote-confirm').checked=true`);
    await click('remote-save');
    await waitFor(`!document.getElementById('remote-pending').hidden && !document.getElementById('remote-save').disabled`);
    stage = 'browser lost-response state assertions';
    assert.equal(writes, 1);
    assert.ok(await evaluate(`document.getElementById('remote-save').textContent.includes('mesmo ID')`));
    await click('remote-save');
    stage = 'browser explicit retry confirmation';
    await waitFor(`document.getElementById('remote-status').textContent.includes('Gravação confirmada')`);
    stage = 'browser committed history assertions';
    assert.equal(writes, 2);
    assert.equal(await evaluate(`document.getElementById('remote-history').children.length`), 1);
    assert.ok(await evaluate(`document.getElementById('remote-history').textContent.includes('7.4')`));
    stage = 'browser unchanged draft assertion after save';
    checkDrafts(await localDrafts(), draftsBefore);
    stage = 'browser no persisted session assertion';
    assert.equal(await evaluate(`localStorage.length + sessionStorage.length`), 0);
    stage = 'browser second reviewed observation';
    await saveReviewed('7,35');
    assert.equal(writes, 3); // Lost first response, retry, then a second distinct observation.
    const beforeReload = await browserApi('/api/observations?encounter_id=' + encounterId);
    assert.equal(beforeReload.status, 200); assert.equal(beforeReload.body.length, 2);
    assert.equal(new Set(beforeReload.body.map(row => row.id)).size, 2);
    const historyBeforeReload = await visibleHistory();
    assert.equal(historyBeforeReload.length, 2);
    console.log('PASS: UI login, two reviewed writes, lost-response retry without duplicate IDs.');

    stage = 'browser reload, fresh login and recovery of exact records';
    const documentMarker = randomUUID();
    await evaluate(`document.documentElement.dataset.testDocument=${JSON.stringify(documentMarker)}`);
    await send('Page.reload', { ignoreCache: true });
    activeUser = null;
    await waitFor(`document.documentElement.dataset.testDocument!==${JSON.stringify(documentMarker)} && !!document.getElementById('remote-content') && !document.getElementById('remote-content').hidden && document.getElementById('persistence-status').textContent.includes('navegador')`);
    await evaluate(`document.getElementById('remote-panel').open=true`);
    assert.equal(await evaluate(`document.getElementById('remote-account').hidden`), true);
    assert.equal(await evaluate(`document.getElementById('remote-workspace').hidden`), true);
    assert.equal(await evaluate(`localStorage.length + sessionStorage.length`), 0);
    await login(users[1]);
    assert.equal(await evaluate(`document.getElementById('remote-unit').value`), '');
    assert.equal(await evaluate(`document.getElementById('remote-encounter').value`), '');
    await selectUnit(fixtures.unitA); await selectEpisode(encounterId);
    const recovered = await browserApi('/api/observations?encounter_id=' + encounterId);
    assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.body, beforeReload.body);
    assert.deepEqual(await visibleHistory(), historyBeforeReload);
    assert.equal(writes, 3);
    checkDrafts(await localDrafts(), draftsBefore);
    console.log('PASS: real page reload clears the UI session; fresh login and explicit selection recover both original IDs and unchanged payloads in the same episode.');

    stage = 'browser unit B login and same-bed episode';
    await logout(); await login(users[2]);
    assert.equal(await evaluate(`Array.from(document.getElementById('remote-unit').options).some(o=>o.value===${JSON.stringify(fixtures.unitA)})`), false);
    await selectUnit(fixtures.unitB);
    await change('remote-bed', bed); await click('remote-create-button');
    await waitFor(`document.getElementById('remote-status').textContent.includes('Novo episódio confirmado')`);
    const episodeB = await evaluate(`document.getElementById('remote-encounter').value`);
    assert.notEqual(episodeB, encounterId);
    await saveReviewed('7,3');
    const recordsB = await browserApi('/api/observations?encounter_id=' + episodeB);
    assert.equal(recordsB.status, 200); assert.equal(recordsB.body.length, 1);
    stage = 'browser unit B cannot read, write or close unit A';
    await assertIsolation(fixtures.unitA, encounterId, beforeReload.body[0]);
    await logout(); await login(users[1]);
    assert.equal(await evaluate(`Array.from(document.getElementById('remote-unit').options).some(o=>o.value===${JSON.stringify(fixtures.unitB)})`), false);
    await selectUnit(fixtures.unitA); await selectEpisode(encounterId);
    const episodesA = await browserApi('/api/encounters?unit_id=' + fixtures.unitA);
    assert.equal(episodesA.body.find(row => row.id === encounterId)?.ended_at, null);
    stage = 'browser unit A cannot read, write or close unit B';
    await assertIsolation(fixtures.unitB, episodeB, recordsB.body[0]);
    console.log('PASS: two units with the same bed label remain separate; bidirectional forged read/write/closure requests from the browser are rejected or return no accessible rows.');
    await logout();

    stage = 'browser reader denial';
    await login(users[0]); await selectUnit(fixtures.unitA); await selectEpisode(encounterId);
    assert.deepEqual(await visibleHistory(), historyBeforeReload);
    assert.equal(await evaluate(`Array.from(document.getElementById('remote-unit').options).some(o=>o.value===${JSON.stringify(fixtures.unitB)})`), false);
    await change('remote-value', '7,2');
    await evaluate(`document.getElementById('remote-confirm').checked=true`);
    await click('remote-save');
    await waitFor(`document.getElementById('remote-status').textContent.includes('Sem permissão') && !document.getElementById('remote-discard').disabled`);
    await click('remote-discard');
    await change('remote-bed', '997'); await click('remote-create-button');
    await waitFor(`document.getElementById('remote-status').textContent.includes('Sem permissão') && !document.getElementById('remote-discard').disabled`);
    assert.equal(created.length, 2);
    await click('remote-discard'); await click('remote-close');
    await waitFor(`!document.getElementById('remote-close').disabled && document.getElementById('remote-status').className.includes('amber')`);
    assert.ok(!(await evaluate(`document.getElementById('remote-status').textContent`)).includes('Encerramento confirmado'));
    const readerRecords = await browserApi('/api/observations?encounter_id=' + encounterId);
    assert.deepEqual(readerRecords.body, beforeReload.body);
    console.log('PASS: reader can recover the two observations but cannot append, create an episode or close the open episode.');
    await logout();

    stage = 'browser owner verification and closure';
    for (const [user, unitId, id, expected] of [[users[1], fixtures.unitA, encounterId, beforeReload.body], [users[2], fixtures.unitB, episodeB, recordsB.body]]) {
      await login(user); await selectUnit(unitId); await selectEpisode(id);
      const episodes = await browserApi('/api/encounters?unit_id=' + unitId);
      assert.equal(episodes.body.find(row => row.id === id)?.ended_at, null);
      const records = await browserApi('/api/observations?encounter_id=' + id);
      assert.deepEqual(records.body, expected);
      await click('remote-close');
      await waitFor(`document.getElementById('remote-status').textContent.includes('Encerramento confirmado')`);
      assert.equal(await evaluate(`document.getElementById('remote-save').disabled`), true);
      await logout();
    }
    checkDrafts(await localDrafts(), draftsBefore);
    assert.equal(await evaluate(`document.getElementById('remote-user').textContent`), '');
    assert.equal(await evaluate(`localStorage.length + sessionStorage.length`), 0);
    console.log('PASS: both owners confirm unchanged records and close only their new episodes; local IndexedDB drafts remain unchanged.');
  } finally {
    // Only close episodes generated by this invocation; retain immutable events.
    const cleanup = await Promise.allSettled(created.map(row => store.closeEncounter(row.token, row.id)));
    const logout = await Promise.allSettled([...sessionTokens].map(token => store.signOut(token)));
    socket?.close();
    for (const call of pending.values()) clearTimeout(call.timeout);
    chrome?.kill();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    const resolved = path.resolve(profile);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep + 'osler-ui-test-')) throw new Error('Unexpected browser profile path');
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
    if ([...cleanup, ...logout].some(row => row.status === 'rejected')) throw new Error('Synthetic episode or session cleanup failed');
  }
  console.log('Browser persistence and isolation suite passed; new synthetic records retained, generated episodes closed and sessions/profile cleaned up.');
}
main().catch(() => { console.error(`Browser integration failed at: ${stage}. Credentials and browser payloads suppressed.`); process.exitCode = 1; });
