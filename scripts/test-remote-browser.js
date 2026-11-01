'use strict';
// Opt-in real Chromium + real development Auth/API. Never prints CDP payloads.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
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
  let writes = 0, loseResponse = true;
  const wrappedStore = { ...store,
    signIn: async (...args) => {
      const session = await store.signIn(...args); sessionTokens.add(session.access_token); return session;
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
  const waitFor = expression => until(() => evaluate(expression));
  async function change(id, value) {
    await evaluate(`(()=>{const el=document.getElementById(${JSON.stringify(id)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  }
  const click = id => evaluate(`document.getElementById(${JSON.stringify(id)}).click()`);
  async function login(user) {
    await change('remote-email', user.email); await change('remote-password', user.password);
    await click('remote-login-button');
    await waitFor(`!document.getElementById('remote-workspace').hidden && !document.getElementById('remote-refresh').disabled`);
    assert.equal(await evaluate(`document.getElementById('remote-password').value`), '');
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
    stage = 'browser episode closure and logout';
    await click('remote-close');
    await waitFor(`document.getElementById('remote-status').textContent.includes('Encerramento confirmado')`);
    assert.equal(await evaluate(`document.getElementById('remote-save').disabled`), true);
    await click('remote-logout');
    await waitFor(`document.getElementById('remote-account').hidden && !document.getElementById('remote-login-button').disabled`);
    assert.equal(await evaluate(`document.getElementById('remote-user').textContent`), '');
    assert.equal(await localDrafts(), draftsBefore);
    stage = 'browser reader denial';
    await login(users[0]); await change('remote-unit', fixtures.unitA);
    await waitFor(`!document.getElementById('remote-encounter').disabled`);
    await change('remote-encounter', encounterId);
    await waitFor(`document.getElementById('remote-history').textContent.includes('7.4')`);
    await change('remote-bed', '997'); await click('remote-create-button');
    await waitFor(`document.getElementById('remote-status').textContent.includes('Sem permissão')`);
    assert.equal(created.length, 1);
    await click('remote-discard'); await click('remote-logout');
    await waitFor(`document.getElementById('remote-account').hidden && !document.getElementById('remote-login-button').disabled`);
    assert.equal(await localDrafts(), draftsBefore);
    console.log('PASS: real Chromium login/logout, explicit unit/episode, reviewed write, lost-response retry, closure, reader denial and unchanged IndexedDB drafts.');
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
}
main().catch(() => { console.error(`Browser integration failed at: ${stage}. Credentials and browser payloads suppressed.`); process.exitCode = 1; });
