'use strict';
const $ = id => document.getElementById(id);
const categories = {
  vm: ['Ventilação / Gasometria', 'Modo ventilatório, FiO₂, PEEP, volume corrente, pH, PaO₂ e PaCO₂.'],
  vitals: ['Sinais Vitais', 'Frequência cardíaca, pressão arterial, frequência respiratória, temperatura e SpO₂.'],
  fluid: ['Balanço Hídrico', 'Entradas, saídas, diurese e saldo do período, com unidades e horário.'],
  infusions: ['Infusões / DVAs', 'Medicamentos, concentrações, doses e velocidades de administração.'],
  invasive: ['Invasões & Suporte', 'Registre os dispositivos e o suporte em uso, conforme avaliação da equipe.']
};
// Persistência local no navegador (IndexedDB). Os dados não são enviados a terceiros.
const drafts = new Map();
const DB_NAME = 'icu-mind-local';
const DB_VERSION = 1;
let persistenceReady = false;
let saveTimer;
function openPersistenceDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB indisponível'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('beds')) request.result.createObjectStore('beds', { keyPath: 'bed' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir banco local'));
  });
}
async function loadSavedDrafts() {
  const db = await openPersistenceDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('beds', 'readonly');
    const request = tx.objectStore('beds').getAll();
    request.onsuccess = () => { request.result.forEach(item => drafts.set(item.bed, item.data)); db.close(); resolve(); };
    request.onerror = () => { db.close(); reject(request.error || new Error('Falha ao carregar dados')); };
  });
}
function saveDraftsNow() {
  if (!persistenceReady) return;
  const dbPromise = openPersistenceDB();
  dbPromise.then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('beds', 'readwrite');
    const store = tx.objectStore('beds');
    drafts.forEach((data, bed) => store.put({ bed, data }));
    tx.oncomplete = () => { db.close(); const status = $('persistence-status'); if (status) status.textContent = 'Salvo neste navegador'; resolve(); };
    tx.onerror = () => { db.close(); const status = $('persistence-status'); if (status) status.textContent = 'Falha ao salvar — exporte um backup'; reject(tx.error); };
  })).catch(() => { const status = $('persistence-status'); if (status) status.textContent = 'Falha ao salvar — exporte um backup'; });
}
function scheduleSave() {
  const status = $('persistence-status');
  if (status && persistenceReady) status.textContent = 'Salvando…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraftsNow, 250);
}
function exportBackup() {
  capture();
  const payload = { app: 'ICU-Mind', version: 1, exportedAt: new Date().toISOString(), beds: [...drafts.entries()].map(([bed, data]) => ({ bed, data })) };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `icu-mind-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function importBackup(file) {
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload.app !== 'ICU-Mind' || !Array.isArray(payload.beds)) throw new Error('Arquivo incompatível');
    payload.beds.forEach(item => { if (/^\d{2}$/.test(item.bed) && item.data && typeof item.data === 'object') drafts.set(item.bed, item.data); });
    saveDraftsNow(); selectBed(currentBed); $('persistence-status').textContent = 'Backup importado e salvo neste navegador';
  } catch { $('persistence-status').textContent = 'Não foi possível importar esse backup'; }
}
let currentBed = '01';
let currentTab = 'vm';
let ocrBusy = false;
let selectedFile;
let previewUrl;
let recorder;
let recordingBusy = false;
const sharedFields = ['hpp-input', 'hda-input', 'plan-input', 'input-weight', 'input-crcl', 'input-hasbled', 'input-chads'];
const localDate = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
function draft() {
  if (!drafts.has(currentBed)) drafts.set(currentBed, { fields: {}, notes: {}, ocr: {}, date: localDate(), devices: [], severity: null, handover: '', feedback: '', audioUrl: null });
  return drafts.get(currentBed);
}
function capture() {
  const data = draft();
  sharedFields.forEach(id => data.fields[id] = $(id).value);
  data.notes[currentTab] = $('manual-text-input').value;
  data.ocr[currentTab] = $('ocr-text').value;
  data.date = $('data-registro').value;
  data.devices = [...document.querySelectorAll('#invasive-suggestions input')].map(input => input.checked);
  scheduleSave();
}
function renderCategory() {
  document.querySelectorAll('.tab-btn').forEach(button => {
    const active = button.dataset.tab === currentTab;
    button.className = 'tab-btn px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ' + (active ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700');
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $('category-panel').setAttribute('aria-labelledby', 'tab-' + currentTab);
  $('category-title').textContent = categories[currentTab][0];
  $('category-description').textContent = categories[currentTab][1];
  $('invasive-suggestions').hidden = currentTab !== 'invasive';
  $('manual-text-input').value = draft().notes[currentTab] || '';
  $('ocr-text').value = draft().ocr[currentTab] || '';
  $('manual-text-input').placeholder = 'Registre: ' + categories[currentTab][1];
  $('upload-zone').setAttribute('aria-label', 'Selecionar imagem: ' + categories[currentTab][0]);
}
function switchTab(tab) {
  if (!categories[tab] || ocrBusy) return;
  capture();
  currentTab = tab;
  clearPreview();
  renderCategory();
}
function selectBed(num) {
  if (ocrBusy || recordingBusy || (recorder && recorder.state !== 'inactive')) {
    $('rec-status').textContent = 'Conclua o OCR ou encerre a gravação antes de trocar de leito.';
    return;
  }
  capture();
  currentBed = num;
  const data = draft();
  sharedFields.forEach(id => $(id).value = data.fields[id] || '');
  $('data-registro').value = data.date;
  document.querySelectorAll('#invasive-suggestions input').forEach((input, i) => input.checked = Boolean(data.devices[i]));
  document.querySelectorAll('.bed-btn').forEach(button => {
    const active = button.dataset.bed === num;
    button.className = 'bed-btn px-3 py-1.5 rounded-lg text-xs transition ' + (active ? 'bg-indigo-600 text-white font-bold' : 'bg-slate-800 text-slate-400 hover:bg-slate-700');
    button.setAttribute('aria-pressed', String(active));
  });
  $('active-bed').textContent = 'Leito ' + num;
  $('handover-content').style.whiteSpace = 'pre-wrap';
  $('handover-content').textContent = data.handover || 'Nenhuma passagem gerada para este leito.';
  $('handover-status').textContent = data.handover ? (data.dirty ? 'Há alterações. Gere a passagem novamente antes de copiar.' : 'Rascunho gerado nesta sessão. Revise antes de usar.') : 'Preencha os dados e gere a passagem para revisão.';
  $('feedback-status').textContent = data.feedback;
  scheduleSave();
  $('input-status').textContent = '';
  $('rec-status').textContent = 'Standby';
  clearPreview();
  renderCategory();
  renderSeverity();
  renderAudio();
  recalcularFarmaco();
  recalcularAnticoagulation();
  updateAutoScores();
}
function setSeverity(level) {
  if (!['stable', 'warning', 'critical'].includes(level)) return;
  markDirty();
  draft().severity = level;
  draft().feedback = '';
  $('feedback-status').textContent = '';
  renderSeverity();
  scheduleSave();
}
function renderSeverity() {
  const level = draft().severity;
  const setting = {
    stable: ['Leito Estável', 'emerald', '#0b0f19'],
    warning: ['Potencial Instabilização', 'amber', '#181204'],
    critical: ['Crítico / Emergência', 'red', '#1c0808']
  }[level] || ['Sem triagem', 'slate', '#0b0f19'];
  const [title, color, background] = setting;
  $('main-body').style.backgroundColor = background;
  $('severity-badge').textContent = title;
  $('severity-badge').className = `text-xs px-2 py-1 rounded bg-${color}-500/20 text-${color}-300`;
  $('status-indicator').className = `p-2 rounded-xl bg-${color}-600`;
  $('pred-card').className = `glass-card rounded-2xl p-5 border-l-4 border-l-${color}-500`;
  $('pred-title').textContent = title;
  $('pred-badge').textContent = 'Leito ' + currentBed + ' · Triagem manual';
  document.querySelectorAll('[data-severity]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.severity === level)));
}
function numberValue(id, min, max, integer = false) {
  const input = $(id);
  const value = input.value.trim();
  const parsed = value === '' ? NaN : Number(value);
  const valid = Number.isFinite(parsed) && parsed >= min && parsed <= max && (!integer || Number.isInteger(parsed));
  input.setAttribute('aria-invalid', String(value !== '' && !valid));
  return valid ? parsed : null;
}
function recalcularFarmaco() {
  const weight = numberValue('input-weight', 1, 500);
  const crcl = numberValue('input-crcl', 0, Infinity);
  $('nutri-recommendation').textContent = weight === null
    ? 'Informe um peso válido entre 1 e 500 kg para calcular a referência.'
    : `Referência aritmética: ${Math.round(weight * 25)}–${Math.round(weight * 30)} kcal/dia (25–30 kcal/kg) e ${(weight * 1.3).toFixed(1)}–${(weight * 1.5).toFixed(1)} g de proteína/dia (1,3–1,5 g/kg), para ${weight} kg. A meta individual depende da avaliação nutricional e clínica.`;
  $('renal-review').textContent = crcl === null ? 'Complete os dados para calcular o ClCr. Nenhum valor padrão é presumido.' : `ClCr calculado: ${crcl} mL/min. A escolha e a dose de cada medicamento dependem da indicação, da função renal e do protocolo aplicável.`;
  $('lethal-alert-box').hidden = crcl === null || crcl >= 30;
  $('lethal-alert-text').textContent = crcl !== null && crcl < 30 ? 'ClCr abaixo de 30 mL/min: solicite revisão de medicamentos com eliminação renal, incluindo anticoagulantes. Este valor isolado não identifica uma interação medicamentosa nem determina uma dose.' : '';
}
function recalcularAnticoagulation() {
  const hasbled = numberValue('input-hasbled', 0, 9, true);
  const chads = numberValue('input-chads', 0, 9, true);
  const crcl = numberValue('input-crcl', 0, Infinity);
  const parts = [];
  parts.push(hasbled === null ? 'HAS-BLED: pendente. Confira os dados necessários no painel de escores.' : `HAS-BLED calculado: ${hasbled}. ${hasbled >= 3 ? 'Escore elevado: revisar fatores modificáveis de sangramento e acompanhamento.' : 'Interpretar no contexto clínico.'}`);
  parts.push(chads === null ? 'CHA₂DS₂-VASc: pendente. Confira os dados necessários no painel de escores.' : `CHA₂DS₂-VASc calculado: ${chads}. Aplicável à avaliação de risco em fibrilação atrial, conforme contexto e diretriz.`);
  if (crcl !== null) parts.push(`ClCr calculado: ${crcl} mL/min.`);
  parts.push('Os escores isolados não definem dose, não indicam profilaxia de UTI e não justificam suspender anticoagulação. A decisão depende da indicação, contraindicações e avaliação da equipe.');
  $('anticoagulation-analysis').textContent = parts.join(' ');
}
function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  selectedFile = undefined;
  previewUrl = undefined;
  $('report-preview').hidden = true;
  $('report-preview').removeAttribute('src');
  $('file-upload').value = '';
  $('upload-status').textContent = '';
  $('ocr-button').disabled = true;
}
function previewReport(file) {
  if (!file || ocrBusy) return;
  clearPreview();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    $('upload-status').textContent = 'Selecione uma imagem JPG, PNG ou WebP.';
    return;
  }
  if (!file.size || file.size > 10 * 1024 * 1024) {
    $('upload-status').textContent = 'A imagem deve ter conteúdo e no máximo 10 MB.';
    return;
  }
  const preview = $('report-preview');
  selectedFile = file;
  previewUrl = URL.createObjectURL(file);
  preview.onload = () => { $('ocr-button').disabled = false; processarFotoOCR(); };
  $('ocr-text').value = '';
  draft().ocr[currentTab] = '';
  markDirty();
  updateAutoScores();
  preview.onerror = () => {
    clearPreview();
    $('upload-status').textContent = 'Não foi possível abrir a imagem. Selecione outro arquivo.';
  };
  preview.src = previewUrl;
  preview.hidden = false;
  $('upload-status').textContent = file.name + ' · imagem selecionada. Iniciando OCR automaticamente…';
}
function lockOCR(locked) {
  ocrBusy = locked;
  document.querySelectorAll('.bed-btn, .tab-btn, #file-upload, #apply-ocr, #ocr-text').forEach(element => element.disabled = locked);
  $('ocr-button').disabled = locked || !selectedFile;
  $('upload-zone').setAttribute('aria-disabled', String(locked));
}
async function processarFotoOCR() {
  if (ocrBusy || !selectedFile) return;
  if (!window.Tesseract) {
    $('upload-status').textContent = 'O leitor OCR não carregou. Verifique a conexão e recarregue a página.';
    return;
  }
  lockOCR(true);
  let worker;
  try {
    $('upload-status').textContent = 'Carregando leitor OCR em português…';
    worker = await Tesseract.createWorker('por', 1, {
      logger: message => {
        if (message.status === 'recognizing text') $('upload-status').textContent = 'Reconhecendo texto… ' + Math.round(message.progress * 100) + '%';
      }
    });
    const result = await worker.recognize(selectedFile);
    const text = result.data.text.trim();
    $('ocr-text').value = text;
    draft().ocr[currentTab] = text;
    markDirty();
    updateAutoScores();
    $('upload-status').textContent = text ? 'Texto extraído. Escores atualizados automaticamente. Revise o texto, as unidades e as pendências no painel.' : 'Nenhum texto legível encontrado. Tente uma imagem mais nítida ou digite as notas.';
  } catch {
    $('upload-status').textContent = 'Não foi possível reconhecer o texto. Verifique a conexão, tente outra imagem ou digite as notas.';
  } finally {
    if (worker) { try { await worker.terminate(); } catch {} }
    lockOCR(false);
  }
}
function applyOCR() {
  const text = $('ocr-text').value.trim();
  if (!text) { $('upload-status').textContent = 'Extraia ou digite um texto e revise antes de adicionar às notas.'; return; }
  $('manual-text-input').value = [$('manual-text-input').value.trim(), text].filter(Boolean).join('\n\n');
  markDirty();
  capture();
  updateAutoScores();
  $('upload-status').textContent = 'Texto revisado adicionado às notas de ' + categories[currentTab][0] + '.';
}
function generateHandover() {
  updateAutoScores();
  recalcularFarmaco();
  recalcularAnticoagulation();
  if (sharedFields.some(id => $(id).getAttribute('aria-invalid') === 'true')) {
    $('input-status').textContent = 'Corrija os campos numéricos antes de gerar a passagem.';
    return;
  }
  $('input-status').textContent = '';
  capture();
  const data = draft();
  const hasData = sharedFields.some(id => data.fields[id]) || Object.values(data.notes).some(text => text.trim()) || data.devices.some(Boolean) || data.severity;
  if (!hasData) {
    $('handover-status').textContent = 'Preencha ao menos um dado do leito antes de gerar a passagem.';
    return;
  }
  const fields = data.fields;
  const missing = value => value && value.trim() ? value.trim() : 'Não informado';
  const lines = [
    `PASSAGEM DE PLANTÃO — LEITO ${currentBed}`,
    `Data do registro: ${data.date ? data.date.replace('T', ' ') : 'Não informada'}`,
    `Triagem manual: ${$('severity-badge').textContent}`,
    '', '[S — SITUAÇÃO / HDA]', missing(fields['hda-input']),
    '', '[B — HISTÓRIA PATOLÓGICA PREGRESSA]', missing(fields['hpp-input']),
    '', '[A — DADOS INFORMADOS PELA EQUIPE]'
  ];
  for (const [key, [title]] of Object.entries(categories)) lines.push(`${title}: ${missing(data.notes[key])}`);
  const devices = [...document.querySelectorAll('#invasive-suggestions label')].filter((label, i) => data.devices[i]).map(label => label.textContent.trim());
  lines.push('Dispositivos selecionados: ' + (devices.join(', ') || 'Não informados'));
  for (const [id, label, unit] of [['input-weight', 'Peso', 'kg'], ['input-crcl', 'ClCr', 'mL/min'], ['input-hasbled', 'HAS-BLED', ''], ['input-chads', 'CHA₂DS₂-VASc', '']]) {
    lines.push(`${label}: ${fields[id] && $(id).getAttribute('aria-invalid') !== 'true' ? fields[id] + ' ' + unit : 'Não informado ou inválido'}`);
  }
  if (data.scoreResult) {
    lines.push('', '[ESCORES AUTOMÁTICOS — REVISAR]');
    Object.values(data.scoreResult).forEach(result=>lines.push(result.name+': '+scoreValueText(result)+(result.complete?'':' — falta/revisar: '+result.missing.join('; '))));
  }
  lines.push('', '[R — PLANO INFORMADO PELA EQUIPE]', missing(fields['plan-input']), '', 'Rascunho organizado a partir dos dados informados, sem validação clínica automática.');
  data.handover = lines.join('\n');
  data.dirty = false;
  $('handover-content').textContent = data.handover;
  $('handover-content').style.whiteSpace = 'pre-wrap';
  $('handover-status').textContent = 'Passagem atualizada com os dados informados. Revise antes de usar.';
  scheduleSave();
  $('handover-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function processarDadosCompletos() {
  recalcularFarmaco();
  recalcularAnticoagulation();
  const invalid = sharedFields.filter(id => $(id).getAttribute('aria-invalid') === 'true');
  if (invalid.length) {
    $('input-status').textContent = 'Corrija os campos numéricos destacados antes de gerar a passagem.';
    $(invalid[0]).focus();
    return;
  }
  $('input-status').textContent = '';
  generateHandover();
}
async function copyHandover() {
  if (!draft().handover) { $('handover-status').textContent = 'Gere a passagem antes de copiar.'; return; }
  if (draft().dirty) { $('handover-status').textContent = 'Há alterações. Gere a passagem novamente antes de copiar.'; return; }
  try {
    await navigator.clipboard.writeText(draft().handover);
    $('handover-status').textContent = 'Passagem copiada.';
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents($('handover-content'));
    selection.removeAllRanges();
    selection.addRange(range);
    $('handover-status').textContent = 'Cópia automática indisponível. O texto está selecionado para copiar manualmente.';
  }
}
function feedback(button, type) {
  if (!draft().severity) { $('feedback-status').textContent = 'Informe a triagem deste leito primeiro.'; return; }
  draft().feedback = 'Feedback nesta sessão: ' + type + '.';
  $('feedback-status').textContent = draft().feedback;
  scheduleSave();
}
function renderAudio() {
  const data = draft();
  $('recording-result').hidden = !data.audioUrl;
  if (data.audioUrl) {
    $('round-audio').src = data.audioUrl;
    $('download-audio').href = data.audioUrl;
    $('download-audio').download = `round-leito-${currentBed}.${data.audioType && data.audioType.includes('mp4') ? 'm4a' : 'webm'}`;
  } else {
    $('round-audio').removeAttribute('src');
    $('round-audio').load();
  }
}
async function toggleRoundRecording() {
  if (recordingBusy) return;
  if (recorder && recorder.state === 'recording') {
    recordingBusy = true;
    $('btn-round').disabled = true;
    recorder.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    $('rec-status').textContent = 'Gravação indisponível neste navegador. Use um navegador compatível em HTTPS.';
    return;
  }
  recordingBusy = true;
  $('btn-round').disabled = true;
  $('rec-status').textContent = 'Aguardando permissão do microfone…';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const owner = draft();
    const chunks = [];
    const supportedType = ['audio/webm;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, supportedType ? { mimeType: supportedType } : undefined);
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    let failed = false;
    recorder.onerror = () => {
      failed = true;
      stream.getTracks().forEach(track => track.stop());
      $('rec-status').textContent = 'Falha na gravação. Tente novamente.';
      $('btn-round').textContent = 'Iniciar Gravação do Round';
      $('btn-round').disabled = false;
    };
    recorder.onstop = () => {
      recordingBusy = false;
      stream.getTracks().forEach(track => track.stop());
      const type = recorder.mimeType || 'audio/webm';
      const blob = new Blob(chunks, { type });
      if (!failed && blob.size) {
        if (owner.audioUrl) URL.revokeObjectURL(owner.audioUrl);
        owner.audioUrl = URL.createObjectURL(blob);
        owner.audioType = type;
        renderAudio();
      }
      $('rec-status').textContent = failed ? 'Falha na gravação. Tente novamente.' : blob.size ? 'Gravação concluída. Ouça ou baixe o áudio.' : 'Nenhum áudio capturado. Tente novamente.';
      $('btn-round').textContent = 'Iniciar Gravação do Round';
      $('btn-round').disabled = false;
    };
    recorder.start();
    $('rec-status').textContent = 'Gravando · Leito ' + currentBed;
    $('btn-round').textContent = 'Encerrar Gravação';
  } catch (error) {
    if (stream) stream.getTracks().forEach(track => track.stop());
    $('rec-status').textContent = error.name === 'NotAllowedError' ? 'Permissão do microfone negada. Autorize o acesso no navegador e tente novamente.' : 'Não foi possível acessar o microfone. Verifique o dispositivo e tente novamente.';
  } finally {
    recordingBusy = false;
    $('btn-round').disabled = false;
  }
}

const uploadZone = $('upload-zone');
uploadZone.addEventListener('click', () => { if (!ocrBusy) $('file-upload').click(); });
uploadZone.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!ocrBusy) $('file-upload').click(); }
});
uploadZone.addEventListener('dragover', event => event.preventDefault());
uploadZone.addEventListener('drop', event => { event.preventDefault(); previewReport(event.dataTransfer.files[0]); });
document.querySelector('[role="tablist"]').addEventListener('keydown', event => {
  const tabs = [...document.querySelectorAll('.tab-btn')];
  const index = tabs.indexOf(document.activeElement);
  if (index < 0 || ocrBusy) return;
  const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  switchTab(tabs[next].dataset.tab);
  tabs[next].focus();
});
function markDirty() {
  if (draft().handover) {
    draft().dirty = true;
    $('handover-status').textContent = 'Há alterações. Gere a passagem novamente antes de copiar.';
  }
}
document.querySelectorAll('textarea, input').forEach(input => input.addEventListener('input', () => {
  markDirty();
  capture();
  if (input.tagName === 'TEXTAREA') scheduleAutoScores();
}));
window.addEventListener('beforeunload', event => {
  if (ocrBusy || recordingBusy || (recorder && recorder.state !== 'inactive') || [...drafts.values()].some(data => data.handover || data.audioUrl || data.severity || Object.values(data.fields).some(Boolean) || Object.values(data.notes).some(Boolean) || Object.values(data.ocr).some(Boolean) || data.devices.some(Boolean)) || [...document.querySelectorAll('textarea')].some(input => input.value.trim())) {
    event.preventDefault();
    event.returnValue = '';
  }
});
async function bootICUMind() {
  try {
    await loadSavedDrafts();
    $('persistence-status').textContent = 'Dados recuperados deste navegador';
  } catch (error) {
    $('persistence-status').textContent = 'Banco local indisponível — use exportação de backup';
  }
  persistenceReady = true;
  $('data-registro').value = draft().date;
  renderCategory();
  renderSeverity();
  recalcularFarmaco();
  recalcularAnticoagulation();
  initScoreUI();
  if (window.lucide) lucide.createIcons();
  scheduleSave();
}
bootICUMind();
