'use strict';

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createStore({ url, key, fetchImpl = fetch }) {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
    throw new Error('SUPABASE_URL must be an HTTPS origin');
  }
  if (!key) throw new Error('SUPABASE_PUBLISHABLE_KEY is required');
  async function request(path, token, { method = 'GET', body } = {}) {
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method, redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
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
    try { return await response.json(); }
    catch { throw new ApiError(503, 'Invalid backend response'); }
  }
  return {
    listUnits: token => request('/rest/v1/units?select=id,label&order=label.asc,id.asc&limit=100', token),
    async authenticate(token) {
      const user = await request('/auth/v1/user', token);
      if (!user.id) throw new ApiError(401, 'Invalid session');
    },
    listEncounters: (token, unit) => request(`/rest/v1/encounters?unit_id=eq.${unit}&select=*&order=started_at.desc&limit=100`, token),
    createEncounter: (token, body) => request('/rest/v1/encounters', token, { method: 'POST', body }),
    closeEncounter: (token, id) => request(`/rest/v1/encounters?id=eq.${id}&ended_at=is.null`, token,
      { method: 'PATCH', body: { ended_at: new Date().toISOString() } }),
    listObservations: (token, id) => request(`/rest/v1/observation_events?encounter_id=eq.${id}&select=*&order=measured_at.desc,id.desc&limit=100`, token),
    appendObservation: (token, body) => request('/rest/v1/rpc/append_observation', token, { method: 'POST', body })
  };
}
module.exports = { createStore, ApiError };
