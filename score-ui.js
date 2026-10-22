'use strict';
let scoreTimer;
function scoreSourceText() {
  const data=draft();
  return [data.fields['hpp-input'],data.fields['hda-input'],...Object.values(data.notes),...Object.values(data.ocr)].filter(Boolean).join('\n');
}
function scheduleAutoScores() {
  clearTimeout(scoreTimer);
  scoreTimer=setTimeout(updateAutoScores,300);
}
function scoreValueText(result) {
  return result.complete ? (result.unit==='mL/min'?result.value.toFixed(1):String(result.value))+' '+result.unit : 'Pendente';
}
function updateAutoScores() {
  clearTimeout(scoreTimer);
  capture();
  const data=draft();
  const text=scoreSourceText();
  if (data.scoreText!==text) {
    data.scoreOverrides={};
    data.scoreReviewFields=[];
    data.scoreText=text;
  }
  const extracted=ClinicalScores.extract(text);
  const merged={...extracted,...data.scoreOverrides};
  const results=ClinicalScores.calculate(merged);
  data.scoreResult=results;
  data.scoreExtracted=extracted;
  data.scoreMerged=merged;
  $('score-bed').textContent=currentBed;
  const computed=Object.values(results).filter(r=>r.complete).length;
  $('score-status').textContent=text.trim() || Object.keys(data.scoreOverrides||{}).length ? `${computed}/5 calculados · ${Object.keys(extracted).length} dados reconhecidos` : 'Aguardando texto ou imagem';
  const output=$('score-results');
  output.replaceChildren();
  for(const [key,result] of Object.entries(results)) {
    const card=document.createElement('article');
    card.dataset.score=key;
    card.className='p-3 rounded-xl border '+(result.complete?'border-emerald-800 bg-emerald-950/20':'border-slate-700 bg-slate-900/50');
    const heading=document.createElement('div');
    heading.className='flex justify-between flex-wrap gap-2 items-center';
    const title=document.createElement('h4');title.className='text-xs font-bold text-slate-200';title.textContent=result.name;
    const value=document.createElement('output');value.className='text-sm font-bold '+(result.complete?'text-emerald-300':'text-amber-300');value.textContent=scoreValueText(result);value.setAttribute('aria-label',result.name+': '+scoreValueText(result));
    heading.append(title,value);card.append(heading);
    if (!result.complete) {
      const pending=document.createElement('p');pending.className='text-xs text-slate-400 mt-2 leading-relaxed';
      pending.textContent='Falta/revisar: '+result.missing.join('; ')+'.';card.append(pending);
    }
    const note=document.createElement('p');note.className='text-xs text-slate-500 mt-2 leading-relaxed';note.textContent=result.note;card.append(note);
    if(result.parts.length) {
      const detail=document.createElement('details');detail.className='mt-2 text-xs text-slate-400';
      const summary=document.createElement('summary');summary.className='cursor-pointer';
      summary.textContent=result.complete?'Ver componentes e pontos':`Ver componentes · subtotal disponível ${result.subtotal} (não é o escore)`;
      const list=document.createElement('ul');list.className='mt-2 space-y-1';
      result.parts.forEach(part=>{const li=document.createElement('li');li.textContent=part.label+': '+(part.points===null?'pendente':part.points+' pontos');list.append(li);});
      detail.append(summary,list);card.append(detail);
    }
    output.append(card);
  }
  // Compatibility with nutrition, anticoagulation and handover panels: only completed values are populated.
  for(const [id,key] of [['input-crcl','crcl'],['input-hasbled','hasbled'],['input-chads','chads']]) {
    $(id).value=results[key].complete?(key==='crcl'?results[key].value.toFixed(1):results[key].value):'';
  }
  $('input-weight').value=merged.weight && merged.weight.value!==null && !merged.weight.error?merged.weight.value:'';
  ['input-crcl','input-hasbled','input-chads','input-weight'].forEach(id=>data.fields[id]=$(id).value);
  renderScoreEditor();
  recalcularFarmaco();recalcularAnticoagulation();
}
function renderScoreEditor() {
  const data=draft();
  const merged=data.scoreMerged||{};
  const keys=new Set([...Object.keys(merged),...(data.scoreReviewFields||[])]);
  const container=$('score-extracted');container.replaceChildren();
  if (!keys.size) {
    const message=document.createElement('p');message.className='text-xs text-slate-400';message.textContent='Nenhum dado reconhecido. Use os nomes e unidades do guia ou acrescente uma informação para revisão.';container.append(message);
  }
  for(const field of ClinicalScores.fields.filter(f=>keys.has(f.key))) {
    const entry=merged[field.key];
    const row=document.createElement('div');row.className='p-3 bg-slate-800/70 rounded-lg';
    const label=document.createElement('label');label.className='block text-xs text-slate-200';label.htmlFor='review-'+field.key;label.textContent=field.label+(field.unit?' ('+field.unit+')':'');row.append(label);
    let input;
    if(field.type==='number') {
      input=document.createElement('input');input.type='number';input.min=field.min;input.max=field.max;input.step=field.integer?'1':'any';input.value=entry && entry.value!==null?entry.value:'';
    } else {
      input=document.createElement('select');input.multiple=field.type==='multi';
      if(!input.multiple) {const empty=document.createElement('option');empty.value='';empty.textContent='Não informado';input.append(empty);}
      Object.entries(field.options).forEach(([key,value])=>{const option=document.createElement('option');option.value=key;option.textContent=value;option.selected=entry && (Array.isArray(entry.value)?entry.value.includes(key):String(entry.value)===key);input.append(option);});
    }
    input.id='review-'+field.key;input.className='mt-2 p-2 w-full bg-slate-900 border border-slate-700 rounded text-xs';
    input.setAttribute('aria-invalid',String(Boolean(entry?.error)));
    input.addEventListener('change',()=>{
      let value;
      let error;
      if(field.type==='number') {
        value=input.value===''?null:Number(input.value);
        if(value!==null&&(!Number.isFinite(value)||value<field.min||value>field.max||(field.integer&&!Number.isInteger(value)))) {error='Valor fora do intervalo permitido.';value=null;}
      } else if(field.type==='multi') {
        value=[...input.selectedOptions].map(option=>option.value);
        if(!value.length)value=null;
        else if(value.includes('none')&&value.length>1) {error='Nenhuma contradiz os outros itens.';value=null;}
      } else value=input.value===''?null:field.type==='boolean'?input.value==='true':input.value;
      draft().scoreOverrides||={};
      draft().scoreOverrides[field.key]={value,error,source:'Correção manual revisada para este texto.'};
      markDirty();updateAutoScores();
    });
    const source=document.createElement('p');source.className='text-xs text-slate-400 mt-2 break-words';
    source.textContent=entry?(entry.error?'Revisar: '+entry.error+' · ':'')+'Origem: '+entry.source:'Informação não encontrada no texto.';
    row.append(input,source);container.append(row);
  }
}
function initScoreUI() {
  for(const field of ClinicalScores.fields) {const option=document.createElement('option');option.value=field.key;option.textContent=field.label;$('score-add-field').append(option);}
  $('score-add-field').addEventListener('change',event=>{
    if(!event.target.value)return;
    const key=event.target.value;
    draft().scoreReviewFields||=[];
    if(!draft().scoreReviewFields.includes(key))draft().scoreReviewFields.push(key);
    renderScoreEditor();$('review-'+key).focus();event.target.value='';
  });
  $('score-format-example').textContent=`idade: 70; sexo: masculino; peso: 70 kg
creatinina: 1,2 mg/dL; bilirrubina total: 1 mg/dL
plaquetas: 150.000 /mm3; leucócitos: 12.000 /mm3
temperatura: 37 °C; FC: 80 bpm; pH: 7,40
PAS: 120 mmHg; PAM: 80 mmHg; Glasgow: 15
PaO2: 90 mmHg; FiO2: 30%; diurese 24h: 1.500 mL/24h
ventilação mecânica: não; suporte respiratório: não
sem DVA: sim

HAS: sim; insuficiência cardíaca: não; diabetes: não
AVC prévio: não; AVC/AIT/embolia: não; doença vascular: não
hipertensão não controlada: não; disfunção renal HAS-BLED: não
disfunção hepática HAS-BLED: não; sangramento prévio: não
INR lábil: não; antiagregante/AINE: não; álcool HAS-BLED: não

Para SAPS 3, acrescente as condições da admissão:
dias antes da UTI: 0; procedência: pronto-socorro
DVA antes da UTI: não; admissão UTI: não planejada
cirurgia: sem cirurgia; infecção: sem infecção
comorbidades SAPS3: nenhuma; motivos admissão: outros
janela SAPS3: sim

Para SOFA, declare a janela correta:
janela SOFA: sim

“Janela SAPS3: sim” confirma os extremos de ±1h da admissão.
“Janela SOFA: sim” confirma os piores valores das 24h.
Não confirme ambas se o conjunto não representa as duas janelas.

Doses em uso devem ter unidade: noradrenalina: 0,1 mcg/kg/min.
Sem declaração “sem DVA: sim”, informe as quatro doses (inclusive zero):
noradrenalina; adrenalina; dopamina; dobutamina.
Para listas SAPS 3, veja as opções disponíveis no revisor de dados.`;
  updateAutoScores();
}
