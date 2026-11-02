'use strict';
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { join, resolve, sep } = require('node:path');
const { randomUUID } = require('node:crypto');
const { securityHeaders, checkOrigin, page, createLimiter, routeLabel } = require('./security.js');
const { ApiError } = require('./supabase.js');
const { validate, rules } = require('../osler-validation.js');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const concepts = { heartRate: 'heart_rate', tidalVolume: 'tidal_volume', respiratoryRate: 'respiratory_rate' };
function checkId(value) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new ApiError(400, 'Invalid identifier');
  return value;
}
async function readBody(req, { allowEmpty = false } = {}) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new ApiError(415, 'JSON required');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new ApiError(413, 'Request too large');
    chunks.push(chunk);
  }
  let body;
  if (!size && allowEmpty) return {};
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'Invalid JSON'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new ApiError(400, 'Invalid body');
  return body;
}
function fields(body, allowed) {
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, 'Unexpected field');
}
const staticAssets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/score-ui.js': ['score-ui.js', 'text/javascript; charset=utf-8'],
  '/clinical-scores.js': ['clinical-scores.js', 'text/javascript; charset=utf-8'],
  '/osler-validation.js': ['osler-validation.js', 'text/javascript; charset=utf-8'],
  '/backend-client.js': ['backend-client.js', 'text/javascript; charset=utf-8'],
  '/remote-session.js': ['remote-session.js', 'text/javascript; charset=utf-8'],
  '/remote-ui.js': ['remote-ui.js', 'text/javascript; charset=utf-8'],
  '/clinical-engine.js': ['clinical-engine.js', 'text/javascript; charset=utf-8'],
  '/clinical-catalog.js': ['clinical-catalog.js', 'text/javascript; charset=utf-8'],
  '/remote-engine-ui.js': ['remote-engine-ui.js', 'text/javascript; charset=utf-8'],
  '/ui-bindings.js': ['ui-bindings.js', 'text/javascript; charset=utf-8'],
  '/osler-logo.svg': ['osler-logo.svg', 'image/svg+xml']
};
function createServer(store, { staticRoot, enableRemoteUI = false, rateLimits, onSecurityEvent = () => {} } = {}) {
  const limit = createLimiter(rateLimits);
  const server = http.createServer(async (req, res) => {
    securityHeaders(res);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const requestId = randomUUID();
    res.setHeader('X-Request-ID', requestId);
    let route = 'other', actorId = null;
    res.once('finish', () => {
      if (!req.url.startsWith('/api/')) return;
      try { onSecurityEvent({ timestamp: new Date().toISOString(), request_id: requestId,
        method: ['GET','HEAD','POST','PATCH','PUT','DELETE','OPTIONS'].includes(req.method)?req.method:'OTHER', route, status: res.statusCode, actor_id: actorId }); } catch { /* Logging must not expose request data on failure. */ }
    });
    try {
      const path = new URL(req.url, 'http://localhost');
      route = routeLabel(path.pathname);
      checkOrigin(req); limit(req);
      if(path.pathname.startsWith('/api/') && Number(req.headers['content-length'] || 0)>16384) throw new ApiError(413,'Request too large');
      if (staticRoot && path.pathname.startsWith('/vendor/') && ['GET', 'HEAD'].includes(req.method)) {
        const manifest = JSON.parse(await readFile(join(staticRoot, 'vendor/manifest.json'), 'utf8'));
        const asset = manifest.files.find(item => '/' + item.file === path.pathname);
        if (!asset) throw new ApiError(404, 'Not found');
        const file = resolve(staticRoot, asset.file);
        if (!file.startsWith(resolve(staticRoot, 'vendor') + sep)) throw new ApiError(404, 'Not found');
        const content = await readFile(file);
        res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
        res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      // Explicit allowlist only: never expose .env, backend source or archives.
      if (staticRoot && Object.hasOwn(staticAssets, path.pathname) && ['GET', 'HEAD'].includes(req.method)) {
        const [file, type] = staticAssets[path.pathname];
        const content = await readFile(join(staticRoot, file));
        res.setHeader('Content-Type', type);
        res.end(req.method === 'HEAD' ? undefined : content); return;
      }
      if (path.pathname === '/health' && req.method === 'GET') {
        res.end(JSON.stringify({ status: 'ok' })); return;
      }
      if (path.pathname === '/api/auth/config' && req.method === 'GET') {
        res.end(JSON.stringify({ enabled: enableRemoteUI })); return;
      }
      if (path.pathname.startsWith('/api/auth/') && !enableRemoteUI) throw new ApiError(404, 'Not found');
      if (path.pathname.startsWith('/api/auth/') && req.method === 'POST') {
        const origin = req.headers.origin;
        if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && new URL(origin).host !== req.headers.host)) {
          throw new ApiError(403, 'Origin denied');
        }
      }
      if (path.pathname === '/api/auth/login' && req.method === 'POST') {
        const body = await readBody(req); fields(body, ['email', 'password']);
        if (typeof body.email !== 'string' || !/^osler-synthetic-[a-z0-9-]+@example\.com$/.test(body.email) ||
            typeof body.password !== 'string' || !body.password || body.password.length > 1024) throw new ApiError(400, 'Synthetic credentials required');
        const session = await store.signIn(body.email, body.password);
        actorId=session.user?.id || null;
        res.end(JSON.stringify(session)); return;
      }
      // Bearer-only API: never accept implicit cookie credentials or enable CORS.
      const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(req.headers.authorization || '');
      if (!match || match[1].length > 8192) throw new ApiError(401, 'Session required');
      const token = match[1];
      if (path.pathname === '/api/auth/logout' && req.method === 'POST') {
        fields(await readBody(req,{allowEmpty:true}),[]);
        res.end(JSON.stringify(await store.signOut(token))); return;
      }
      if (path.pathname === '/api/auth/refresh' && req.method === 'POST') {
        fields(await readBody(req,{allowEmpty:true}),[]);
        const session=await store.refreshSession(token); actorId=session.user?.id || null;
        res.end(JSON.stringify(session)); return;
      }
      if (path.pathname === '/api/auth/mfa' && req.method === 'POST') {
        const body = await readBody(req); fields(body,['factor_id','code']);
        const session=await store.verifyMfa(token,body.factor_id,body.code); actorId=session.user?.id || null;
        res.end(JSON.stringify(session)); return;
      }
      const identity = await store.authenticate(token);
      actorId = identity?.id || null;
      let result;
      if (path.pathname === '/api/units' && req.method === 'GET') {
        result = await store.listUnits(token, page(path.searchParams));
      } else if (path.pathname === '/api/encounters' && req.method === 'GET') {
        result = await store.listEncounters(token, checkId(path.searchParams.get('unit_id')), page(path.searchParams, ['unit_id']));
      } else if (path.pathname === '/api/encounters' && req.method === 'POST') {
        const body = await readBody(req); fields(body, ['id', 'unit_id', 'bed_code']);
        checkId(body.id); checkId(body.unit_id);
        if (typeof body.bed_code !== 'string' || !/^\d{2,3}$/.test(body.bed_code)) throw new ApiError(400, 'Invalid bed');
        result = await store.createEncounter(token, body);
      } else if (/^\/api\/encounters\/[^/]+\/close$/.test(path.pathname) && req.method === 'POST') {
        fields(await readBody(req,{allowEmpty:true}),[]);
        result = await store.closeEncounter(token, checkId(path.pathname.split('/')[3]));
      } else if (path.pathname === '/api/observations' && req.method === 'GET') {
        result = await store.listObservations(token, checkId(path.searchParams.get('encounter_id')), page(path.searchParams, ['encounter_id']));
      } else if (path.pathname === '/api/observations/correct' && req.method === 'POST') {
        const body=await readBody(req); fields(body,['original_event_id','id','value','unit','timestamp','reason_code']);
        checkId(body.original_event_id); checkId(body.id);
        if (typeof body.value!=='number' || !Number.isFinite(body.value) || typeof body.unit!=='string' || body.unit.length>40 ||
            typeof body.timestamp!=='string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.timestamp) ||
            !Number.isFinite(Date.parse(body.timestamp)) || !['transcription','unit','measurement','other'].includes(body.reason_code)) throw new ApiError(422,'Invalid correction');
        result=await store.correctObservation(token,{original_event:body.original_event_id,replacement_event:body.id,
          replacement_value:body.value,replacement_unit:body.unit,replacement_time:body.timestamp,reason:body.reason_code});
      } else if (path.pathname === '/api/observations' && req.method === 'POST') {
        const body = await readBody(req);
        fields(body, ['id', 'encounter_id', 'concept', 'value', 'unit', 'timestamp', 'confirmed', 'source_type']);
        checkId(body.id); checkId(body.encounter_id);
        if (typeof body.concept !== 'string' || !Object.hasOwn(rules, body.concept)) throw new ApiError(422, 'Invalid concept');
        if (typeof body.timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.timestamp)) throw new ApiError(422, 'Timestamp with timezone required');
        const checked = validate({ [body.concept]: body });
        if (checked.reviewRequired || !['manual', 'device', 'laboratory', 'document'].includes(body.source_type)) throw new ApiError(422, 'Invalid confirmed observation');
        result = await store.appendObservation(token, {
          event_id: body.id, target_encounter: body.encounter_id,
          observation_concept: concepts[body.concept] || body.concept,
          observation_value: body.value, observation_unit: body.unit,
          observation_time: body.timestamp, observation_source: body.source_type
        });
      } else { throw new ApiError(404, 'Not found'); }
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = error instanceof ApiError ? error.status : 500;
      if (res.statusCode === 429) res.setHeader('Retry-After', '60');
      res.end(JSON.stringify({ error: error instanceof ApiError ? error.message : 'Internal error' }));
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return server;
}
module.exports = { createServer };
