'use strict';
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { ApiError } = require('./supabase.js');
const { validate, rules } = require('../osler-validation.js');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const concepts = { heartRate: 'heart_rate', tidalVolume: 'tidal_volume', respiratoryRate: 'respiratory_rate' };
function checkId(value) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new ApiError(400, 'Invalid identifier');
  return value;
}
async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw new ApiError(415, 'JSON required');
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new ApiError(413, 'Request too large');
    chunks.push(chunk);
  }
  let body;
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
  '/osler-logo.svg': ['osler-logo.svg', 'image/svg+xml']
};
function createServer(store, { staticRoot } = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const path = new URL(req.url, 'http://localhost');
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
      // Bearer-only API: never accept implicit cookie credentials or enable CORS.
      const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(req.headers.authorization || '');
      if (!match || match[1].length > 8192) throw new ApiError(401, 'Session required');
      const token = match[1];
      await store.authenticate(token);
      let result;
      if (path.pathname === '/api/encounters' && req.method === 'GET') {
        result = await store.listEncounters(token, checkId(path.searchParams.get('unit_id')));
      } else if (path.pathname === '/api/encounters' && req.method === 'POST') {
        const body = await readBody(req); fields(body, ['id', 'unit_id', 'bed_code']);
        checkId(body.id); checkId(body.unit_id);
        if (typeof body.bed_code !== 'string' || !/^\d{2,3}$/.test(body.bed_code)) throw new ApiError(400, 'Invalid bed');
        result = await store.createEncounter(token, body);
      } else if (/^\/api\/encounters\/[^/]+\/close$/.test(path.pathname) && req.method === 'POST') {
        result = await store.closeEncounter(token, checkId(path.pathname.split('/')[3]));
      } else if (path.pathname === '/api/observations' && req.method === 'GET') {
        result = await store.listObservations(token, checkId(path.searchParams.get('encounter_id')));
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
      res.end(JSON.stringify({ error: error instanceof ApiError ? error.message : 'Internal error' }));
    }
  });
}
module.exports = { createServer };
