'use strict';
// Opt-in real Chromium + real development Auth/API. Never prints CDP payloads.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { generate } = require('otplib');
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
  const externalOrigins=new Set();
  const securityEvents=[];
  const sessionsByEmail = new Map();
  let activeUser;
  let ownFactor, ownFactorSecret, factorCleanupToken;
  async function factorRequest(endpoint,token,method='GET',body){
    return fetch(fixtures.projectUrl+'/auth/v1/'+endpoint,{method,redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  }
  async function factorCode(){
    const response=await factorRequest('settings',factorCleanupToken);
    assert.equal(response.status,200);
    return generate({secret:ownFactorSecret,epoch:Math.floor(Date.parse(response.headers.get('date'))/1000)});
  }
  let writes = 0, loseResponse = true, delaySnapshot=false, snapshotStarted=false, releaseSnapshot, failSnapshot=false,documentWrites=0,loseDocumentReply=true,failDocumentRead=true;
  const documentBodies=[];
  const wrappedStore = { ...store,
    listDocumentSources:async(...args)=>{if(documentWrites===2&&failDocumentRead){failDocumentRead=false;throw new ApiError(503,'Synthetic provenance read outage');}return store.listDocumentSources(...args);},
    appendDocumentObservation:async(token,body)=>{
      assert.ok(created.some(row=>row.id===body.target_encounter));documentWrites++;documentBodies.push(JSON.parse(JSON.stringify(body)));
      const result=await store.appendDocumentObservation(token,body);
      if(documentWrites===2&&loseDocumentReply){loseDocumentReply=false;throw new ApiError(503,'Synthetic lost document reply');}return result;
    },
    engineSnapshot:async(...args)=>{
      if(failSnapshot)throw new ApiError(503,'Synthetic snapshot outage');
      const result=await store.engineSnapshot(...args);
      if(delaySnapshot){snapshotStarted=true;await new Promise(resolve=>{releaseSnapshot=resolve;setTimeout(resolve,10000).unref();});}
      return result;
    },
    signIn: async (...args) => {
      const session = await store.signIn(...args);
      sessionTokens.add(session.access_token); sessionsByEmail.set(session.user.email, session.access_token); return session;
    },
    signOut: async token => {
      const result=await store.signOut(token);
      const id=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).session_id;
      for(const issued of sessionTokens)if(JSON.parse(Buffer.from(issued.split('.')[1],'base64url').toString()).session_id===id)sessionTokens.delete(issued);
      return result;
    },
    refreshSession: async token => {
      const session=await store.refreshSession(token); sessionTokens.delete(token);sessionTokens.add(session.access_token);
      sessionsByEmail.set(session.user.email,session.access_token);return session;
    },
    verifyMfa: async (token,...args)=>{
      const session=await store.verifyMfa(token,...args);sessionTokens.delete(token);sessionTokens.add(session.access_token);
      sessionsByEmail.set(session.user.email,session.access_token);factorCleanupToken=session.access_token;return session;
    },
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
  const server = createServer(wrappedStore, { staticRoot: path.resolve(__dirname, '..'), enableRemoteUI: true,
    onSecurityEvent:event=>securityEvents.push(event) });
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
    assert.ok(endpoint.startsWith('/api/encounters') || endpoint.startsWith('/api/observations') || endpoint.startsWith('/api/document-observations') || endpoint==='/api/engine/snapshot');
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
      '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',
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
      if(message.method==='Network.requestWillBeSent') {
        const url=message.params.request.url;
        if(/^https?:/.test(url) && new URL(url).hostname!=='127.0.0.1')externalOrigins.add(new URL(url).origin);
      }
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
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    await waitFor(`!!document.getElementById('remote-content') && !document.getElementById('remote-content').hidden && document.getElementById('persistence-status').textContent.includes('navegador')`);
    await evaluate(`document.getElementById('remote-panel').open=true`);
    stage='local backup validation and export minimization';
    await send('Browser.setDownloadBehavior',{behavior:'deny'},null);
    const invalidImport=await evaluate(`(async()=>{const before=JSON.stringify([...drafts]);await importBackup(new File([JSON.stringify({app:'ICU-Mind',version:1,beds:[{bed:'10',data:{fields:null}}]})],'synthetic-invalid.json',{type:'application/json'}));return JSON.stringify([...drafts])===before;})()`);
    assert.equal(invalidImport,true);
    await evaluate(`(async()=>{await importBackup(new File([JSON.stringify({app:'ICU-Mind',version:1,beds:[{bed:'10',data:{fields:{},notes:{vm:'Backup sintético local'},ocr:{},devices:[],audioUrl:'javascript:alert(1)'}}]})],'synthetic-valid.json',{type:'application/json'}));})()`);
    assert.equal(await evaluate(`drafts.get('10').audioUrl`),null);
    const exportSafe=await evaluate(`(async()=>{let blob;const original=URL.createObjectURL;URL.createObjectURL=function(value){if(value.type==='application/json')blob=value;return original.call(this,value);};try{exportBackup();const text=await blob.text();return !text.includes('javascript:') && !text.includes('access_token') && !text.includes('refresh_token') && !text.includes('remote-password');}finally{URL.createObjectURL=original;}})()`);
    assert.equal(exportSafe,true);assert.equal(writes,0);
    console.log('PASS: malformed import changes no draft, imported blob/script URLs are discarded, and explicit export contains no Auth material.');
    stage='same-origin styles, OCR and synthetic audio';
    assert.equal(await evaluate(`getComputedStyle(document.body).backgroundColor`),'rgb(8, 9, 12)');
    assert.equal(await evaluate(`document.querySelectorAll('[onclick],[oninput],[onchange],script[src^="http"]').length`),0);
    await evaluate(`new Promise(resolve=>{const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=250;const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,1000,250);context.fillStyle='black';context.font='64px Arial';context.fillText('pH: 7.40',60,140);canvas.toBlob(blob=>{const transfer=new DataTransfer();transfer.items.add(new File([blob],'synthetic-ocr.png',{type:'image/png'}));const input=document.getElementById('file-upload');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));resolve();},'image/png');})`);
    await waitFor(`document.getElementById('upload-status').textContent.startsWith('OCR preliminar')`);
    assert.ok(await evaluate(`document.getElementById('ocr-text').value.includes('7.40')`));
    assert.equal(writes,0);
    await click('btn-round');await waitFor(`document.getElementById('rec-status').textContent.includes('Gravando')`);
    await new Promise(resolve=>setTimeout(resolve,400));await click('btn-round');
    await waitFor(`document.getElementById('rec-status').textContent.includes('concluída')`);
    assert.ok(await evaluate(`document.getElementById('round-audio').src.startsWith('blob:')`));
    // Discard only the temporary in-memory fake-device audio before comparing drafts.
    await evaluate(`draft().audioUrl && URL.revokeObjectURL(draft().audioUrl);draft().audioUrl=null;delete draft().audioType;renderAudio();clearPreview();document.getElementById('ocr-text').value='';draft().ocr.vm='';`);
    console.log('PASS: self-hosted CSS/icons/OCR worker/model under CSP, synthetic image recognition and fake-device local audio.');
    await change('manual-text-input', 'Rascunho sintético local que não deve ser enviado.');
    // Wait for the existing asynchronous score calculation and draft write too.
    await until(async () => JSON.parse(await localDrafts()).some(row => row.data?.scoreText?.includes('Rascunho sintético local')));
    const draftsBefore = await localDrafts();
    stage = 'browser login and explicit selection';
    await login(users[1]);
    stage='browser temporary MFA setup and step-up';
    const enroll=await factorRequest('factors',sessionsByEmail.get(users[1].email),'POST',{
      factor_type:'totp',friendly_name:'osler-browser-disposable-'+randomUUID()
    });
    assert.equal(enroll.status,200);
    const factorData=await enroll.json();ownFactor=factorData.id;ownFactorSecret=factorData.totp.secret;
    const initialCode=await generate({secret:ownFactorSecret,epoch:Math.floor(Date.parse(enroll.headers.get('date'))/1000)});
    const initialStepUp=await store.verifyMfa(sessionsByEmail.get(users[1].email),ownFactor,initialCode);
    factorCleanupToken=initialStepUp.access_token;sessionTokens.add(factorCleanupToken);
    await logout();await login(users[1]);
    assert.equal(await evaluate(`document.getElementById('remote-mfa').hidden`),false);
    await change('remote-mfa-code',await factorCode());await click('remote-mfa-button');
    await waitFor(`document.getElementById('remote-status').textContent.includes('MFA confirmado')`);
    assert.equal(await evaluate(`document.getElementById('remote-mfa-code').value`),'');
    assert.equal(JSON.parse(Buffer.from(sessionsByEmail.get(users[1].email).split('.')[1],'base64url').toString()).aal,'aal2');
    const remove=await factorRequest('factors/'+ownFactor,factorCleanupToken,'DELETE');assert.equal(remove.status,200);
    assert.ok(!JSON.stringify(securityEvents).includes(ownFactorSecret));ownFactor=null;ownFactorSecret=undefined;
    console.log('PASS: real UI MFA step-up reaches AAL2 without logging codes; only the execution-owned temporary factor is removed.');
    stage='browser renewed login session';
    await click('remote-renew');await waitFor(`document.getElementById('remote-status').textContent.includes('Sessão renovada')`);
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
    assert.equal(externalOrigins.size,0);
    const serializedLogs=JSON.stringify(securityEvents);
    for(const user of users) assert.ok(!serializedLogs.includes(user.password));
    for(const sessionToken of sessionTokens) assert.ok(!serializedLogs.includes(sessionToken));
    assert.ok(!serializedLogs.includes('Rascunho sintético local'));
    console.log('PASS: no external HTTP origins, no credentials/clinical values in audit logs, and refresh stays server-side.');
    stage = 'browser second reviewed observation';
    await change('remote-concept','creatinine');
    await saveReviewed('1,0');
    assert.equal(writes, 3); // Lost first response, retry, then a second distinct observation.
    const beforeReload = await browserApi('/api/observations?encounter_id=' + encounterId);
    assert.equal(beforeReload.status, 200); assert.equal(beforeReload.body.length, 2);
    assert.equal(new Set(beforeReload.body.map(row => row.id)).size, 2);
    const historyBeforeReload = await visibleHistory();
    assert.equal(historyBeforeReload.length, 2);
    stage = 'browser isolated engine preview and explicit review';
    assert.equal(await evaluate(`document.getElementById('engine-catalog').children.length`),6);
    assert.equal(await evaluate(`document.getElementById('engine-preview').disabled`),true);
    const episodeInfo=(await browserApi('/api/encounters?unit_id='+fixtures.unitA)).body.find(e=>e.id===encounterId);
    const localDate=iso=>{const date=new Date(iso);return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,23);};
    // Round upward so millisecond input cannot precede the database microsecond start.
    await change('engine-start',localDate(new Date(Math.ceil(Date.parse(episodeInfo.started_at)/1000)*1000).toISOString()));
    await change('engine-end',localDate(new Date().toISOString()));
    await click('engine-load');
    await waitFor(`!document.getElementById('engine-preview').disabled`);
    assert.equal(await evaluate(`document.querySelectorAll('#engine-candidates input:checked').length`),0);
    await click('engine-preview');
    assert.ok(await evaluate(`document.getElementById('engine-result').textContent.includes('recusada')`));
    await evaluate(`document.querySelector('#engine-candidates input').click();document.getElementById('engine-confirm').checked=true`);
    await click('engine-preview');
    const preview=JSON.parse(await evaluate(`document.getElementById('engine-result').textContent`));
    assert.equal(preview.result.status,'abstained');assert.equal(preview.result.estimate,undefined);
    assert.equal(preview.provenance.context.unitId,fixtures.unitA);assert.equal(preview.provenance.context.encounterId,encounterId);
    assert.ok(beforeReload.body.some(e=>e.id===preview.provenance.events[0].event.id));
    assert.equal(writes,3);checkDrafts(await localDrafts(),draftsBefore);
    await click('remote-refresh');
    await waitFor(`!document.getElementById('remote-refresh').disabled`);
    assert.equal(await evaluate(`document.querySelectorAll('#engine-candidates input:checked').length`),0);
    assert.ok(await evaluate(`document.getElementById('engine-result').textContent.includes('invalidada')`));
    console.log('PASS: isolated remote engine requires explicit review, retains provenance, abstains on missing criteria and invalidates on refresh without changing drafts or writing.');
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
    assert.ok(!(await evaluate(`document.getElementById('engine-result').textContent`)).includes(encounterId));
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
    stage='browser full reviewed engine assessment with correction chain';
    await login(users[1]);await selectUnit(fixtures.unitA);
    await change('remote-bed','988');await click('remote-create-button');
    await waitFor(`document.getElementById('remote-status').textContent.includes('Novo episódio confirmado')`);
    const engineEpisode=await evaluate(`document.getElementById('remote-encounter').value`);
    await change('remote-concept','weight');await saveReviewed('72');
    await change('remote-concept','creatinine');await saveReviewed('1');
    const engineEvents=(await browserApi('/api/observations?encounter_id='+engineEpisode)).body;
    const originalCr=engineEvents.find(e=>e.concept==='creatinine'),weightEvent=engineEvents.find(e=>e.concept==='weight');
    const fix1={original_event_id:originalCr.id,id:randomUUID(),value:2,unit:'mg/dL',timestamp:originalCr.measured_at,reason_code:'measurement'};
    const fix2={...fix1,original_event_id:fix1.id,id:randomUUID(),value:1};
    assert.equal((await browserApi('/api/observations/correct','POST',fix1)).status,200);
    assert.equal((await browserApi('/api/observations/correct','POST',fix2)).status,200);
    const engineInfo=(await browserApi('/api/encounters?unit_id='+fixtures.unitA)).body.find(e=>e.id===engineEpisode);
    await until(()=>Date.now()>Math.max(...engineEvents.map(e=>Date.parse(e.measured_at)))+10);
    const windowEnd=new Date().toISOString();
    await change('engine-start',localDate(new Date(Math.ceil(Date.parse(engineInfo.started_at)/1000)*1000).toISOString()));
    await change('engine-end',localDate(windowEnd));await click('engine-load');
    await waitFor(`!document.getElementById('engine-preview').disabled`);
    assert.equal(await evaluate(`document.querySelectorAll('#engine-candidates input:checked').length`),0);
    assert.equal(await evaluate(`document.querySelector('#engine-candidates input[value="${originalCr.id}"]').disabled`),true);
    assert.equal(await evaluate(`document.querySelector('#engine-candidates input[value="${fix1.id}"]').disabled`),true);
    await evaluate(`document.querySelector('#engine-candidates input[value="${fix2.id}"]').click();document.querySelector('#engine-candidates input[value="${weightEvent.id}"]').click()`);
    await change('engine-source','synthetic-browser-assessment');await change('engine-effective',localDate(originalCr.measured_at));
    for(const [field,value] of Object.entries({age:'68',sex:'male',acuteKidney:'false',dialysis:'false',representativeWeight:'true',stableRenal:'true',temporalCompatibility:'true',clinicalCoverage:'true'})){
      await change('engine-supp-'+field,value);await click('engine-reviewed-'+field);
    }
    await evaluate(`document.getElementById('engine-confirm').checked=true`);await click('engine-preview');
    const assessment=JSON.parse(await evaluate(`document.getElementById('engine-result').textContent`));
    assert.equal(assessment.result.status,'included');assert.equal(assessment.result.estimate.value,72);
    assert.equal(assessment.provenance.supplements.length,8);assert.equal(assessment.provenance.corrections.length,2);
    assert.equal(assessment.provenance.context.encounterId,engineEpisode);
    assert.deepEqual(assessment.provenance.events.find(e=>e.event.id===fix2.id).lineage,[originalCr.id,fix1.id]);
    await change('engine-source','synthetic-browser-reassessment');
    assert.equal(await evaluate(`document.getElementById('engine-reviewed-age').checked`),false);
    assert.equal(await evaluate(`document.getElementById('engine-confirm').checked`),false);
    for(const field of ['age','sex','acuteKidney','dialysis','representativeWeight','stableRenal','temporalCompatibility','clinicalCoverage'])await click('engine-reviewed-'+field);
    await change('engine-supp-acuteKidney','true');assert.equal(await evaluate(`document.getElementById('engine-reviewed-acuteKidney').checked`),false);
    await click('engine-reviewed-acuteKidney');await evaluate(`document.getElementById('engine-confirm').checked=true`);await click('engine-preview');
    const excluded=JSON.parse(await evaluate(`document.getElementById('engine-result').textContent`));assert.equal(excluded.result.status,'excluded');assert.equal(excluded.result.estimate,undefined);
    const unchanged=(await browserApi('/api/observations?encounter_id='+engineEpisode)).body.find(e=>e.id===originalCr.id);assert.deepEqual(unchanged,originalCr);
    stage='browser snapshot response race and provider outage';
    delaySnapshot=true;snapshotStarted=false;await click('engine-load');await until(()=>snapshotStarted);
    await change('engine-end',localDate(new Date(Date.parse(windowEnd)-1).toISOString()));releaseSnapshot();delaySnapshot=false;
    await waitFor(`!document.getElementById('remote-refresh').disabled`);
    await waitFor(`document.getElementById('engine-result').textContent.includes('Consulta recusada')`);
    assert.equal(await evaluate(`document.getElementById('engine-preview').disabled`),true);
    assert.equal(await evaluate(`document.querySelectorAll('#engine-candidates input').length`),0);
    await change('engine-end',localDate(windowEnd));failSnapshot=true;await click('engine-load');
    await waitFor(`document.getElementById('remote-status').className.includes('amber') && !document.getElementById('remote-refresh').disabled`);failSnapshot=false;
    assert.equal(await evaluate(`document.getElementById('engine-preview').disabled`),true);
    assert.equal(await evaluate(`document.getElementById('engine-load').disabled`),false);
    await click('engine-load');await waitFor(`!document.getElementById('engine-preview').disabled`);
    assert.equal(await evaluate(`document.querySelectorAll('#engine-candidates input:checked').length`),0);
    checkDrafts(await localDrafts(),draftsBefore);
    await click('remote-close');await waitFor(`document.getElementById('remote-status').textContent.includes('Encerramento confirmado')`);
    await logout();assert.equal(await evaluate(`document.getElementById('engine-source').value`),'');
    assert.equal(await evaluate(`document.getElementById('engine-start').value`),'');
    console.log('PASS: real remote CG uses explicitly selected correction leaf and eight traceable reviewed supplements; AKI excludes, originals/drafts remain unchanged and logout clears supplemental context.');
    await require('./test-document-browser-flow.js')({evaluate,change,click,waitFor,until,send,login,logout,selectUnit,selectEpisode,browserApi,users,fixtures,localDrafts,checkDrafts,draftsBefore,
      documentWrites:()=>documentWrites,documentBodies,externalOrigins,securityEvents,localDate,setStage:value=>{stage=value;}});
  } finally {
    // Only close episodes generated by this invocation; retain immutable events.
    const cleanup = await Promise.allSettled(created.map(row => store.closeEncounter(row.token, row.id)));
    if(ownFactor){const removal=await factorRequest('factors/'+ownFactor,factorCleanupToken,'DELETE');assert.equal(removal.status,200);ownFactor=null;ownFactorSecret=undefined;}
    const logout = await Promise.allSettled([...sessionTokens].map(token => store.signOut(token)));
    socket?.close();
    for (const call of pending.values()) clearTimeout(call.timeout);
    chrome?.kill();
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    const resolved = path.resolve(profile);
    if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep + 'osler-ui-test-')) throw new Error('Unexpected browser profile path');
    await fs.rm(resolved, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
    if ([...cleanup, ...logout].some(row => row.status === 'rejected')) {
      console.error('Cleanup failures (HTTP status only): '+[...cleanup,...logout].filter(row=>row.status==='rejected').map(row=>row.reason.status || 'local').join(','));
      throw new Error('Synthetic episode or session cleanup failed');
    }
  }
  console.log('Browser persistence and isolation suite passed; new synthetic records retained, generated episodes closed and sessions/profile cleaned up.');
}
main().catch(() => { console.error(`Browser integration failed at: ${stage}. Credentials and browser payloads suppressed.`); process.exitCode = 1; });
