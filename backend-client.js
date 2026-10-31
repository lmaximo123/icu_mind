/* Optional same-origin API adapter. No automatic upload of IndexedDB drafts. */
(function(root) {
  'use strict';
  function createClient({ getAccessToken, fetchImpl = root.fetch.bind(root) }) {
    if (typeof getAccessToken !== 'function') throw new Error('Session provider required');
    async function request(path, method = 'GET', body) {
      const token = await getAccessToken();
      if (!token) throw new Error('Session required');
      const response = await fetchImpl(path, {
        method, credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) throw new Error(`Osler API request failed (${response.status})`);
      return response.json();
    }
    return {
      listEncounters: unitId => request(`/api/encounters?unit_id=${encodeURIComponent(unitId)}`),
      createEncounter: encounter => request('/api/encounters', 'POST', encounter),
      closeEncounter: id => request(`/api/encounters/${encodeURIComponent(id)}/close`, 'POST'),
      listObservations: encounterId => request(`/api/observations?encounter_id=${encodeURIComponent(encounterId)}`),
      // Generate and retain observation.id before the first attempt. Reuse that
      // exact ID and payload when retrying. Never silently fall back to local save.
      appendObservation: observation => request('/api/observations', 'POST', observation)
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createClient };
  else root.OslerBackend = { createClient };
})(typeof window !== 'undefined' ? window : globalThis);
