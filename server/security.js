'use strict';
const { createHash } = require('node:crypto');
const { ApiError } = require('./supabase.js');
function securityHeaders(res) {
  const headers = {
    'Cache-Control': 'no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
  };
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
}
function checkOrigin(req) {
  let host;
  try{host=new URL('http://'+req.headers.host).hostname;}catch{throw new ApiError(400,'Invalid host');}
  if(!['127.0.0.1','localhost','[::1]'].includes(host))throw new ApiError(403,'Host denied');
  if (!req.url.startsWith('/api/')) return;
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new ApiError(403, 'Origin denied');
  if (req.headers.origin) {
    let origin;
    try { origin = new URL(req.headers.origin); } catch { throw new ApiError(403, 'Origin denied'); }
    // Loopback server only; a future TLS ingress needs an explicitly reviewed origin.
    if (origin.origin !== `http://${req.headers.host}`) throw new ApiError(403, 'Origin denied');
  }
}
function page(search, identifiers = []) {
  for (const key of search.keys()) if (![...identifiers, 'limit', 'offset'].includes(key) || search.getAll(key).length !== 1) throw new ApiError(400, 'Invalid query');
  const limit = search.get('limit') ?? '100', offset = search.get('offset') ?? '0';
  if (!/^[1-9]\d*$/.test(limit) || Number(limit) > 100 || !/^(0|[1-9]\d*)$/.test(offset) || Number(offset) > 100000) throw new ApiError(400, 'Invalid pagination');
  return { limit: Number(limit), offset: Number(offset) };
}
function createLimiter({ now = Date.now, loginLimit = 20, readLimit = 600, writeLimit = 120, ipLimit = 1200, maxKeys = 10000 } = {}) {
  const buckets = new Map();
  return req => {
    if (!req.url.startsWith('/api/')) return;
    const login = req.url.startsWith('/api/auth/login');
    const write = !['GET', 'HEAD'].includes(req.method);
    const window = login ? 600000 : 60000;
    const category = login ? 'login' : write ? 'write' : 'read';
    const identity = login ? req.socket.remoteAddress : createHash('sha256').update(req.headers.authorization || req.socket.remoteAddress || 'unknown').digest('hex');
    const current = now();
    for (const [id, value] of buckets) if (value.until <= current) buckets.delete(id);
    function consume(key,maximum,duration) {
      if (!buckets.has(key)) {
        if (buckets.size >= maxKeys) throw new ApiError(429, 'Too many requests');
        buckets.set(key, { until: current + duration, count: 0 });
      }
      if (++buckets.get(key).count>maximum)throw new ApiError(429,'Too many requests');
    }
    consume('ip:'+req.socket.remoteAddress,ipLimit,60000);
    consume(`${category}:${identity}`,login ? loginLimit : write ? writeLimit : readLimit,window);
  };
}
function routeLabel(pathname) {
  if (/^\/api\/encounters\/[^/]+\/close$/.test(pathname)) return '/api/encounters/:id/close';
  return ['/api/auth/login','/api/auth/logout','/api/auth/refresh','/api/auth/mfa','/api/auth/config','/api/units','/api/encounters','/api/observations','/api/observations/correct','/api/engine/snapshot','/api/document-observations'].includes(pathname) ? pathname : 'other';
}
module.exports = { securityHeaders, checkOrigin, page, createLimiter, routeLabel };
