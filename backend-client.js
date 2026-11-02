/* Optional same-origin API adapter. No automatic upload of IndexedDB drafts. */
(function(root) {
  'use strict';
  function createClient({ getAccessToken, fetchImpl = root.fetch.bind(root) }) {
    if (typeof getAccessToken !== 'function') throw new Error('Session provider required');
    async function request(path, method = 'GET', body) {
      const token = await getAccessToken();
      if (!token) { const error = new Error('Session required'); error.status = 401; throw error; }
      const response = await fetchImpl(path, {
        method, credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) { const error = new Error(`Osler API request failed (${response.status})`); error.status = response.status; throw error; }
      return response.json();
    }
    function paging(page) {
      if(!page)return '';
      const query=new URLSearchParams();
      for(const key of ['limit','offset'])if(page[key]!==undefined)query.set(key,String(page[key]));
      return query.toString();
    }
    return {
      listUnits: page => request('/api/units'+(paging(page)?'?'+paging(page):'')),
      listEncounters: (unitId,page) => request(`/api/encounters?unit_id=${encodeURIComponent(unitId)}`+(paging(page)?'&'+paging(page):'')),
      createEncounter: encounter => request('/api/encounters', 'POST', encounter),
      closeEncounter: id => request(`/api/encounters/${encodeURIComponent(id)}/close`, 'POST'),
      listObservations: (encounterId,page) => request(`/api/observations?encounter_id=${encodeURIComponent(encounterId)}`+(paging(page)?'&'+paging(page):'')),
      engineSnapshot: body => request('/api/engine/snapshot','POST',body),
      appendDocumentObservation: body=>request('/api/document-observations','POST',body),
      listDocumentSources: (id,page)=>request(`/api/document-observations?encounter_id=${encodeURIComponent(id)}`+(paging(page)?'&'+paging(page):'')),
      correctObservation: correction => request('/api/observations/correct','POST',correction),
      // Generate and retain observation.id before the first attempt. Reuse that
      // exact ID and payload when retrying. Never silently fall back to local save.
      appendObservation: observation => request('/api/observations', 'POST', observation)
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createClient };
  else root.OslerBackend = { createClient };
})(typeof window !== 'undefined' ? window : globalThis);
