'use strict';
const { createHash } = require('node:crypto');

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createStore({ url, key, fetchImpl = fetch, now = Date.now, sessionLifetimeMs = 7200000 } ) {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('SUPABASE_URL must be an HTTPS origin');
  }
  if (!key) throw new Error('SUPABASE_PUBLISHABLE_KEY is required');
  const sessions = new Map();
  const sessionKey = token => createHash('sha256').update(token).digest('hex');
  function remember(session, until = now() + sessionLifetimeMs) {
    if (typeof session.access_token !== 'string' || !session.user?.id ||
        !/^osler-synthetic-[a-z0-9-]+@example\.com$/.test(session.user.email || '') ||
        !Number.isFinite(session.expires_in) || session.expires_in <= 0) throw new ApiError(503, 'Invalid Auth response');
    for (const [id, row] of sessions) if (row.until <= now()) sessions.delete(id);
    if (session.refresh_token) {
      if (sessions.size >= 1000) throw new ApiError(503, 'Session capacity reached');
      let providerSessionId;
      try { providerSessionId=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString()).session_id; } catch { /* Test doubles may use opaque tokens. */ }
      sessions.set(sessionKey(session.access_token), { refresh: session.refresh_token, until, userId: session.user.id, providerSessionId });
    }
    const factors = session.user.factors?.filter(f => f.factor_type === 'totp' && f.status === 'verified').map(f => ({ id: f.id }));
    return { access_token: session.access_token, expires_in: Math.min(session.expires_in, Math.max(1, Math.floor((until-now())/1000))),
      user: { id: session.user.id, email: session.user.email }, ...(factors?.length ? { factors } : {}) };
  }
  function pagination({ limit = 100, offset = 0 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new ApiError(400, 'Invalid pagination');
    return `limit=${limit}${offset ? `&offset=${offset}` : ''}`;
  }
  async function request(path, token, { method = 'GET', body, noContent = false } = {}) {
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', Prefer: 'return=representation' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch { throw new ApiError(503, 'Backend unavailable'); }
    if (!response.ok) {
      const status = response.status;
      if (status === 401) throw new ApiError(401, 'Invalid session');
      if (status === 403) throw new ApiError(403, 'Access denied');
      if (status === 409) throw new ApiError(409, 'Conflicting record');
      if (status === 400 || status === 422) throw new ApiError(422, 'Invalid record');
      throw new ApiError(503, 'Backend unavailable');
    }
    if (noContent && response.status === 204) return { signed_out: true };
    try { return await response.json(); }
    catch { throw new ApiError(503, 'Invalid backend response'); }
  }
  return {
    async signIn(email, password) {
      if (base.href !== 'https://otnwkxchugsovtjdanyu.supabase.co/' || !key.startsWith('sb_publishable_')) {
        throw new ApiError(403, 'Development Auth only');
      }
      if (!/^osler-synthetic-[a-z0-9-]+@example\.com$/.test(email) || typeof password !== 'string' || !password || password.length > 1024) {
        throw new ApiError(400, 'Synthetic credentials required');
      }
      let session;
      try { session = await request('/auth/v1/token?grant_type=password', null, { method: 'POST', body: { email, password } }); }
      catch (error) {
        if ([401, 403, 422].includes(error.status)) throw new ApiError(401, 'Invalid credentials');
        throw error;
      }
      if (!session.access_token || !session.user?.id || session.user.email !== email ||
          !Number.isFinite(session.expires_in) || session.expires_in <= 0) throw new ApiError(503, 'Invalid Auth response');
      // Refresh material stays exclusively in the bounded server-memory vault.
      return remember(session);
    },
    async refreshSession(token) {
      const id = sessionKey(token), entry = sessions.get(id);
      if (!entry || entry.until <= now() || entry.revoked) { sessions.delete(id); throw new ApiError(401, 'Session expired'); }
      if (!entry.refreshing) entry.refreshing = (async () => {
        const session = await request('/auth/v1/token?grant_type=refresh_token', null, { method: 'POST', body: { refresh_token: entry.refresh } });
        if (session.user?.id !== entry.userId) throw new ApiError(401, 'Invalid session');
        if (entry.revoked) { await request('/auth/v1/logout?scope=local', session.access_token, { method:'POST', noContent:true }); throw new ApiError(401,'Session ended'); }
        const result = remember(session, entry.until); if(sessionKey(result.access_token)!==id) sessions.delete(id); return result;
      })().finally(() => { entry.refreshing = null; });
      return entry.refreshing;
    },
    async verifyMfa(token, factorId, code) {
      if (!/^[0-9a-f-]{36}$/i.test(factorId || '') || !/^\d{6}$/.test(code || '')) throw new ApiError(400,'Invalid MFA challenge');
      const challenge = await request(`/auth/v1/factors/${factorId}/challenge`, token, { method:'POST',body:{} });
      const session = await request(`/auth/v1/factors/${factorId}/verify`, token, { method:'POST',body:{challenge_id:challenge.id,code} });
      const entry = sessions.get(sessionKey(token));
      const result = remember(session, entry?.until); if(result.access_token!==token) sessions.delete(sessionKey(token)); return result;
    },
    async signOut(token) {
      const entry = sessions.get(sessionKey(token)); if (entry) entry.revoked=true;
      sessions.delete(sessionKey(token));
      const result=await request('/auth/v1/logout?scope=local', token, { method: 'POST', noContent: true });
      // Read only after Auth accepted the token; logout revokes a session, not one JWT.
      let id;try{id=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).session_id;}catch{}
      if(id)for(const [key,row] of sessions)if(row.providerSessionId===id){row.revoked=true;sessions.delete(key);}
      return result;
    },
    listUnits: (token, page) => request('/rest/v1/units?select=id,label&order=label.asc,id.asc&' + pagination(page), token),
    async authenticate(token) {
      const user = await request('/auth/v1/user', token);
      if (!user.id) throw new ApiError(401, 'Invalid session');
      return { id: user.id };
    },
    listEncounters: (token, unit, page) => request(`/rest/v1/encounters?unit_id=eq.${unit}&select=*&order=started_at.desc,id.desc&${pagination(page)}`, token),
    createEncounter: (token, body) => request('/rest/v1/encounters', token, { method: 'POST', body }),
    closeEncounter: (token, id) => request(`/rest/v1/encounters?id=eq.${id}&ended_at=is.null`, token,
      { method: 'PATCH', body: { ended_at: new Date().toISOString() } }),
    listObservations: (token, id, page) => request(`/rest/v1/observation_events?encounter_id=eq.${id}&select=*&order=measured_at.desc,id.desc&${pagination(page)}`, token),
    engineSnapshot: (token, body) => request('/rest/v1/rpc/engine_snapshot',token,{method:'POST',body}),
    appendObservation: (token, body) => request('/rest/v1/rpc/append_observation', token, { method: 'POST', body }),
    correctObservation: (token, body) => request('/rest/v1/rpc/correct_observation', token, { method: 'POST', body })
  };
}
module.exports = { createStore, ApiError };
