/* DOM adapter for the explicit remote panel. Never reads the local app draft. */
(function() {
  'use strict';
  const $ = id => document.getElementById(id);
  const panel = $('remote-panel');
  if (!panel) return;
  const labels = { ph: 'pH', pao2: 'PaO₂', paco2: 'PaCO₂', fio2: 'FiO₂', peep: 'PEEP', spo2: 'SpO₂',
    heartRate: 'Frequência cardíaca', temperature: 'Temperatura', sbp: 'Pressão sistólica', map: 'PAM',
    sodium: 'Sódio', potassium: 'Potássio', creatinine: 'Creatinina', weight: 'Peso',
    tidalVolume: 'Volume corrente', respiratoryRate: 'Frequência respiratória' };
  for (const key of Object.keys(OslerValidation.rules)) $('remote-concept').append(new Option(labels[key] || key, key));
  function unitLabel() {
    const rule = OslerValidation.rules[$('remote-concept').value];
    $('remote-unit-label').textContent = `${rule.unit || 'Sem unidade'} · faixa: ${rule.min} a ${rule.max}`;
  }
  unitLabel();
  $('remote-concept').addEventListener('change', unitLabel);
  function requireReview(event) {
    if (event.target.id !== 'remote-confirm') $('remote-confirm').checked = false;
  }
  $('remote-measurement-fields').addEventListener('input', requireReview);
  $('remote-measurement-fields').addEventListener('change', requireReview);
  function options(element, rows, value, placeholder, label) {
    element.replaceChildren(new Option(placeholder, ''));
    for (const row of rows) element.append(new Option(label(row), row.id));
    element.value = value;
  }
  function dateLabel(value) { return new Date(value).toLocaleString('pt-BR'); }
  let context = '', savedId = '';
  const controller = OslerRemote.createController({ onChange: render });
  function render(state) {
    window.dispatchEvent(new CustomEvent('osler-remote-state', { detail: state }));
    const connected = !!state.user && !state.expired;
    const pending = !!(state.pending || state.pendingEncounter);
    const episode = state.encounters.find(row => row.id === state.encounterId);
    $('remote-login').hidden = connected;
    $('remote-account').hidden = !state.user;
    $('remote-workspace').hidden = !connected;
    $('remote-user').textContent = state.user ? state.user.email + (state.expired ? ' · sessão expirada' : '') : '';
    $('remote-status').textContent = state.message || 'Entre para acessar as unidades permitidas.';
    $('remote-status').className = 'text-sm mt-3 ' + (state.error ? 'text-amber-200' : 'text-emerald-300');
    $('remote-login-button').disabled = state.busy;
    $('remote-email').disabled = state.busy;
    $('remote-password').disabled = state.busy;
    $('remote-logout').disabled = state.busy;
    $('remote-renew').disabled = state.busy || !connected;
    $('remote-mfa').hidden=!connected || !state.factors?.length;
    $('remote-mfa-button').disabled=state.busy;
    options($('remote-factor'),state.factors || [],(state.factors || [])[0]?.id || '', 'Selecione',row=>'Autenticador '+row.id.slice(0,8));
    options($('remote-unit'), state.units, state.unitId, 'Selecione uma unidade', row => row.label);
    options($('remote-encounter'), state.encounters, state.encounterId, 'Selecione um episódio',
      row => `Leito ${row.bed_code} · ${dateLabel(row.started_at)} · ${row.ended_at ? 'encerrado' : 'aberto'} · ${row.id}`);
    $('remote-unit').disabled = state.busy || pending;
    $('remote-encounter').disabled = state.busy || pending || !state.unitId;
    $('remote-refresh').disabled = state.busy;
    $('remote-bed').disabled = state.busy || pending || !state.unitId;
    $('remote-create-button').disabled = state.busy || !!state.pending || !state.unitId;
    $('remote-create-button').textContent = state.pendingEncounter ? 'Verificar / repetir abertura' : 'Abrir novo episódio';
    $('remote-create').noValidate = !!state.pendingEncounter;
    $('remote-close').disabled = state.busy || pending || !episode || !!episode.ended_at;
    $('remote-measurement-fields').disabled = state.busy || pending || !episode || !!episode.ended_at;
    $('remote-save').disabled = state.busy || !!state.pendingEncounter || !episode || (!!episode.ended_at && !state.pending);
    $('remote-save').textContent = state.pending ? 'Verificar / repetir com o mesmo ID' : 'Enviar observação revisada';
    $('remote-measurement').noValidate = !!state.pending;
    const unit = state.units.find(row => row.id === state.unitId);
    $('remote-destination').textContent = episode ? `${unit?.label || ''} · Leito ${episode.bed_code} · Episódio ${episode.id} · ${episode.ended_at ? 'ENCERRADO' : 'ABERTO'}` : 'Nenhum episódio selecionado. O seletor de leitos locais não escolhe um destino remoto.';
    $('remote-pending').hidden = !pending;
    $('remote-discard').hidden = !pending;
    $('remote-discard').disabled = state.busy;
    $('remote-pending').textContent = state.pending ? `Tentativa pendente: ${state.pending.measurement.id}. O conteúdo e destino estão fixos para retry. Não reenvie com outro ID antes de conferir o histórico.` :
      state.pendingEncounter ? `Abertura pendente: ${state.pendingEncounter.id}. Confira no servidor antes de descartar.` : '';
    const nextContext = `${state.user?.id || ''}/${state.unitId}/${state.encounterId}`;
    if (nextContext !== context || (state.savedId && state.savedId !== savedId)) {
      $('remote-confirm').checked = false; $('remote-value').value = '';
      const instant = Math.ceil(Math.max(Date.now(), episode ? Date.parse(episode.started_at) + 1 : 0) / 1000) * 1000;
      const date = new Date(instant);
      $('remote-time').value = new Date(instant - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
      context = nextContext;
    }
    savedId = state.savedId;
    $('remote-history').replaceChildren();
    for (const row of state.observations) {
      const item = document.createElement('li');
      item.textContent = `${row.concept}: ${row.numeric_value} ${row.unit || ''} · ${dateLabel(row.measured_at)} · ${row.source_type} · ID ${row.id}`;
      $('remote-history').append(item);
    }
    if (!state.observations.length) {
      const item = document.createElement('li'); item.textContent = episode ? 'Nenhuma observação carregada. Use Atualizar para consultar o servidor.' : 'Selecione um episódio para consultar o histórico.';
      $('remote-history').append(item);
    }
  }
  const attempt = promise => { void promise.catch(() => {}); }; // The controller renders sanitized errors.
  $('remote-login').addEventListener('submit', event => {
    event.preventDefault();
    const password = $('remote-password').value; $('remote-password').value = '';
    attempt(controller.login($('remote-email').value.trim(), password));
  });
  $('remote-logout').addEventListener('click', () => {
    const state = controller.getState();
    if ((state.pending || state.pendingEncounter) && !window.confirm('Há uma tentativa sem confirmação. Ela pode existir no servidor. Sair apagará seu ID desta tela. Deseja sair mesmo assim?')) return;
    $('remote-password').value = ''; attempt(controller.logout());
  });
  $('remote-unit').addEventListener('change', () => attempt(controller.selectUnit($('remote-unit').value)));
  $('remote-renew').addEventListener('click',()=>attempt(controller.renewSession()));
  $('remote-mfa').addEventListener('submit',event=>{
    event.preventDefault(); const code=$('remote-mfa-code').value; $('remote-mfa-code').value='';
    attempt(controller.verifyMfa($('remote-factor').value,code));
  });
  $('remote-encounter').addEventListener('change', () => attempt(controller.selectEncounter($('remote-encounter').value)));
  $('remote-refresh').addEventListener('click', () => attempt(controller.refresh()));
  $('remote-create').addEventListener('submit', event => { event.preventDefault(); attempt(controller.createEncounter($('remote-bed').value.trim())); });
  $('remote-measurement').addEventListener('submit', event => {
    event.preventDefault(); attempt(controller.save({ concept: $('remote-concept').value, value: $('remote-value').value,
      timestamp: $('remote-time').value, confirmed: $('remote-confirm').checked, source_type: $('remote-source').value }));
  });
  $('remote-close').addEventListener('click', () => {
    if (window.confirm('Encerrar o episódio selecionado? Novas observações serão bloqueadas.')) attempt(controller.closeEncounter());
  });
  $('remote-discard').addEventListener('click', () => {
    if (window.confirm('O registro pode já existir no servidor. Descartar a tentativa desta tela e conferir o histórico antes de criar outro ID?')) {
      $('remote-confirm').checked = false; controller.discardPending();
    }
  });
  window.addEventListener('beforeunload', event => {
    const state = controller.getState();
    if (state.busy || state.pending || state.pendingEncounter) { event.preventDefault(); event.returnValue = ''; }
  });
  render(controller.getState());
  fetch('/api/auth/config', { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) })
    .then(response => response.ok ? response.json() : { enabled: false })
    .then(config => {
      $('remote-content').hidden = config.enabled !== true;
      $('remote-availability').textContent = config.enabled === true ? 'Ambiente sintético disponível. Sessão apenas em memória; recarregar a página exige novo login.' :
        'API remota desativada. Os recursos locais continuam disponíveis. Use o servidor de desenvolvimento configurado para conectar.';
    }).catch(() => { $('remote-availability').textContent = 'API remota indisponível. Os recursos locais continuam disponíveis.'; });
})();
