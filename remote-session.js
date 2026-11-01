/* Explicit remote workflow. No IndexedDB, localStorage, drafts or automatic writes. */
(function(root) {
  'use strict';
  const backend = typeof module !== 'undefined' && module.exports ? require('./backend-client.js') : root.OslerBackend;
  const validation = typeof module !== 'undefined' && module.exports ? require('./osler-validation.js') : root.OslerValidation;
  function createController({ fetchImpl = root.fetch.bind(root), uuid = () => root.crypto.randomUUID(), now = () => Date.now(), onChange = () => {} } = {}) {
    let token = null, expiry = 0, timer;
    const state = { user: null, expired: false, busy: false, units: [], unitId: '', encounters: [], encounterId: '',
      observations: [], pending: null, pendingEncounter: null, savedId: '', message: '', error: false };
    const snapshot = () => JSON.parse(JSON.stringify(state));
    const emit = () => onChange(snapshot());
    function expire() { token = null; state.expired = true; state.message = 'Sessão expirada. Entre novamente para continuar.'; state.error = true; emit(); }
    const api = backend.createClient({ fetchImpl, getAccessToken: async () => {
      if (token && now() >= expiry) expire();
      return token;
    } });
    async function auth(path, body, accessToken) {
      const response = await fetchImpl('/api/auth/' + path, {
        method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      if (!response.ok) { const error = new Error('Auth request failed'); error.status = response.status; throw error; }
      return response.json();
    }
    function requireSession() { if (!token || state.expired) { const error = new Error('Session required'); error.status = 401; throw error; } }
    function unresolved() { return state.pending || state.pendingEncounter; }
    function requireResolved() { if (unresolved()) throw new Error('Resolve pending attempt'); }
    function invalid(message) { const error = new Error('Invalid input'); error.userMessage = message; throw error; }
    const selected = () => state.encounters.find(row => row.id === state.encounterId && row.unit_id === state.unitId);
    async function run(work, kind = 'request') {
      if (state.busy) throw new Error('Operation in progress');
      state.busy = true; state.message = 'Aguardando confirmação do servidor…'; state.error = false; emit();
      try { await work(); }
      catch (error) {
        state.error = true;
        if (error.status === 401 && kind === 'login') { state.message = 'Não foi possível entrar. Confira as credenciais da conta sintética.'; }
        else if (error.status === 401) { expire(); }
        else state.message = ({ 403: 'Sem permissão para esta ação. Verifique sua função e unidade.',
          409: 'Conflito no servidor. Consulte os registros antes de descartar a tentativa.',
          422: 'Registro recusado. Confira valor, unidade, horário e se o episódio está aberto.' })[error.status] ||
          error.userMessage || (unresolved() ? 'Sem confirmação da gravação. Tente novamente com o mesmo ID ou confira o histórico antes de descartar.' : 'Não foi possível concluir. Confira a conexão e tente novamente.');
        throw error;
      } finally { state.busy = false; emit(); }
    }
    async function history() {
      state.observations = state.encounterId ? await api.listObservations(state.encounterId) : [];
    }
    async function loadEncounters() {
      state.encounters = await api.listEncounters(state.unitId);
      if (!selected()) { state.encounterId = ''; state.observations = []; }
    }
    return {
      getState: snapshot,
      login: (email, password) => run(async () => {
        const session = await auth('login', { email, password });
        if (!session.access_token || !session.user?.id || !Number.isFinite(session.expires_in) || session.expires_in <= 0) throw new Error('Invalid session');
        if (unresolved() && state.user?.id !== session.user.id) {
          await auth('logout', null, session.access_token);
          invalid('Há uma tentativa pendente de outra conta. Entre com a conta original ou descarte a tentativa após conferir o servidor.');
        }
        token = session.access_token; expiry = now() + session.expires_in * 1000;
        clearTimeout(timer); timer = setTimeout(expire, Math.min(session.expires_in * 1000, 2147483647)); timer.unref?.();
        state.user = session.user; state.expired = false; state.observations = [];
        if (!unresolved()) { state.unitId = ''; state.encounterId = ''; state.encounters = []; }
        state.units = await api.listUnits();
        if (state.unitId) {
          if (!state.units.some(unit => unit.id === state.unitId)) throw new Error('Unit no longer accessible');
          await loadEncounters(); if (state.encounterId) await history();
        }
        state.message = state.units.length ? 'Sessão iniciada. Selecione a unidade e o episódio.' : 'Sessão iniciada. Nenhuma unidade disponível para esta conta.';
      }, 'login'),
      logout: () => run(async () => {
        const accessToken = token;
        token = null; clearTimeout(timer);
        Object.assign(state, { user: null, expired: false, units: [], unitId: '', encounters: [], encounterId: '', observations: [], pending: null, pendingEncounter: null, savedId: '' });
        try {
          if (accessToken) { await auth('logout', null, accessToken); state.message = 'Sessão removida desta tela e logout confirmado pelo servidor.'; }
          else state.message = 'Sessão removida desta tela. A sessão expirada não foi revogada no servidor.';
        }
        catch { state.error = true; state.message = 'Sessão removida desta tela. O servidor não confirmou o logout; o token emitido pode continuar válido até expirar.'; }
      }),
      selectUnit: id => run(async () => {
        requireSession(); requireResolved();
        if (id && !state.units.some(unit => unit.id === id)) throw new Error('Select accessible unit');
        state.unitId = id; state.encounterId = ''; state.encounters = []; state.observations = []; state.savedId = '';
        if (id) await loadEncounters();
        state.message = id ? 'Unidade selecionada. Selecione um episódio ou abra um novo.' : 'Selecione uma unidade.';
      }),
      selectEncounter: id => run(async () => {
        requireSession(); requireResolved();
        if (id && !state.encounters.some(row => row.id === id && row.unit_id === state.unitId)) throw new Error('Select explicit encounter');
        state.encounterId = id; state.observations = []; state.savedId = '';
        await history(); state.message = id ? 'Episódio selecionado. Confira o destino antes de enviar.' : 'Selecione um episódio.';
      }),
      refresh: () => run(async () => {
        requireSession(); state.units = await api.listUnits();
        if (state.unitId) { await loadEncounters(); await history(); }
        state.message = 'Lista e histórico atualizados pelo servidor.';
      }),
      createEncounter: bed => run(async () => {
        requireSession();
        if (!state.unitId || state.pending || !/^\d{2,3}$/.test(bed)) throw new Error('Explicit unit and valid bed required');
        if (!state.pendingEncounter) state.pendingEncounter = { id: uuid(), unit_id: state.unitId, bed_code: bed };
        const request = state.pendingEncounter;
        if (request.unit_id !== state.unitId) throw new Error('Pending unit changed');
        // Recover an insert whose response was lost before attempting the same UUID.
        await loadEncounters();
        let row = state.encounters.find(item => item.id === request.id);
        if (!row) { const result = await api.createEncounter(request); row = result[0]; }
        if (!row || row.id !== request.id || row.unit_id !== request.unit_id || row.bed_code !== request.bed_code) throw new Error('Creation not confirmed');
        state.pendingEncounter = null; state.encounters = [row, ...state.encounters.filter(item => item.id !== row.id)];
        state.encounterId = row.id; state.observations = [];
        state.message = 'Novo episódio confirmado no servidor e selecionado.';
      }),
      save: input => run(async () => {
        requireSession();
        if (state.pendingEncounter || !selected()) throw new Error('Select explicit episode');
        if (!state.pending) {
          if (selected().ended_at) throw new Error('Episode closed');
          if (!input || typeof input.value !== 'string' || !input.value.trim() || !Object.hasOwn(validation.rules, input.concept)) invalid('Preencha uma variável e um valor numérico para a observação.');
          if (!input.timestamp || !Number.isFinite(Date.parse(input.timestamp))) invalid('Informe um horário de medição válido.');
          const measurement = { id: uuid(), encounter_id: state.encounterId, concept: input.concept,
            value: Number(input.value.replace(',', '.')), unit: validation.rules[input.concept].unit,
            timestamp: new Date(input.timestamp).toISOString(), confirmed: input.confirmed === true, source_type: input.source_type };
          if (validation.validate({ [measurement.concept]: measurement }).reviewRequired ||
              !['manual', 'device', 'laboratory', 'document'].includes(measurement.source_type)) invalid('Revise a confirmação, a faixa de valor e o horário da medição antes de enviar.');
          state.pending = { unitId: state.unitId, measurement };
        }
        const { measurement, unitId } = state.pending;
        if (unitId !== state.unitId || measurement.encounter_id !== state.encounterId) throw new Error('Pending destination changed');
        const row = await api.appendObservation(measurement);
        const concept = ({ heartRate: 'heart_rate', tidalVolume: 'tidal_volume', respiratoryRate: 'respiratory_rate' })[measurement.concept] || measurement.concept;
        if (row.id !== measurement.id || row.encounter_id !== measurement.encounter_id || row.recorded_by !== state.user.id ||
            Number(row.numeric_value) !== measurement.value || row.unit !== measurement.unit || row.concept !== concept ||
            row.source_type !== measurement.source_type || Date.parse(row.measured_at) !== Date.parse(measurement.timestamp)) throw new Error('Write not confirmed');
        state.savedId = row.id; state.pending = null;
        state.message = 'Gravação confirmada no servidor. ID: ' + row.id;
        try { await history(); } catch { state.message += ' O histórico não foi atualizado; use Atualizar.'; }
      }),
      closeEncounter: () => run(async () => {
        requireSession(); requireResolved();
        if (!selected() || selected().ended_at) throw new Error('Select open episode');
        const id = state.encounterId;
        const rows = await api.closeEncounter(id);
        if (rows.length !== 1 || rows[0].id !== id || !rows[0].ended_at) {
          await loadEncounters(); throw new Error('Closure not confirmed');
        }
        state.encounters = state.encounters.map(row => row.id === id ? rows[0] : row);
        state.message = 'Encerramento confirmado no servidor. Novas observações estão bloqueadas.';
      }),
      discardPending() {
        if (state.busy) return;
        state.pending = null; state.pendingEncounter = null;
        state.message = 'Tentativa descartada apenas nesta tela. O registro pode existir no servidor; confira o histórico antes de enviar outro.';
        state.error = true; emit();
      },
      dispose() { token = null; clearTimeout(timer); }
    };
  }
  const exports = { createController };
  if (typeof module !== 'undefined' && module.exports) module.exports = exports;
  else root.OslerRemote = exports;
})(typeof window !== 'undefined' ? window : globalThis);
