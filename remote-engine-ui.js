/* Isolated remote engine view: no drafts, global state events or browser storage. */
(function(root){
'use strict';
function create({loadSnapshot}){
 const $=id=>document.getElementById(id);let state,signature='',contextSignature='',prepared=null,generation=0;
 const context=()=>({unitId:state.unitId,encounterId:state.encounterId,reviewerId:state.user.id});
 const active=()=>state?.user&&!state.expired&&!state.busy&&!state.error&&state.encounterId;
 const canLoad=()=>state?.user&&!state.expired&&!state.busy&&state.encounterId&&!state.pending&&!state.pendingEncounter;
 const iso=id=>{const value=$(id).value;if(!value)throw Error('Interval required');return new Date(value).toISOString();};
 const definitions={age:'Idade (anos)',sex:'Coeficiente original da fórmula',acuteKidney:'Lesão renal aguda presente?',dialysis:'Diálise presente?',representativeWeight:'Peso representativo para a fórmula?',stableRenal:'Função renal estável?',temporalCompatibility:'Medidas temporalmente compatíveis?',clinicalCoverage:'Cobertura clínica suficiente deste intervalo para esta estimativa?'};
 for(const entry of OslerClinicalCatalog.entries){const item=document.createElement('p');item.textContent=`${entry.id} · ${entry.version} · ${entry.category} · ${entry.status}: ${entry.purpose} Fonte: ${entry.source}`;$('engine-catalog').append(item);}
 for(const [field,labelText] of Object.entries(definitions)){
  const label=document.createElement('label');label.textContent=labelText+' ';
  const input=document.createElement(field==='age'?'input':'select');input.id='engine-supp-'+field;
  if(field==='age'){input.type='number';input.min='0';input.max='120';input.step='1';}
  else {input.append(new Option('Não informado',''));for(const [value,label] of (field==='sex'?[['male','Masculino (original)'],['female','Feminino (original)']]:[['true','Sim'],['false','Não']]))input.append(new Option(label,value));}
  const check=document.createElement('input');check.type='checkbox';check.id='engine-reviewed-'+field;
  label.append(input,check,document.createTextNode('Revisei este item'));$('engine-supplement-fields').append(label,document.createElement('br'));
 }
 function invalidate(clearSupplements=true){
  generation++;prepared=null;$('engine-candidates').replaceChildren();$('engine-confirm').checked=false;$('engine-preview').disabled=true;
  $('engine-result').textContent='Prévia invalidada; revise novamente. Nenhum resultado persistido.';$('engine-coverage').textContent='Nenhuma consulta preparada.';
  if(clearSupplements){for(const field of Object.keys(definitions)){$('engine-supp-'+field).value='';$('engine-reviewed-'+field).checked=false;}$('engine-source').value='';$('engine-effective').value='';}
 }
 function render(nextState){
  state=nextState;
  const nextContext=JSON.stringify([state.user?.id,state.unitId,state.encounterId]);
  if(nextContext!==contextSignature){contextSignature=nextContext;$('engine-start').value='';$('engine-end').value='';}
  $('engine-context').textContent=state.user&&!state.expired?`Unidade ${state.unitId||'não selecionada'} · episódio ${state.encounterId||'não selecionado'}`:'Sem sessão ativa; prévia indisponível.';
  const next=JSON.stringify([state.user?.id,state.expired,state.busy,state.error,state.unitId,state.encounterId,state.observations]);
  if(next!==signature){signature=next;invalidate();}
  $('engine-load').disabled=!canLoad();
 }
 for(const id of ['engine-start','engine-end'])for(const event of ['input','change'])$(id).addEventListener(event,()=>invalidate());
 for(const id of ['engine-candidates','engine-supplements'])$(id).addEventListener('change',()=>{$('engine-confirm').checked=false;$('engine-result').textContent='Entradas alteradas; confirme nova revisão.';});
 $('engine-supplements').addEventListener('input',event=>{
  if(event.target.id.startsWith('engine-supp-'))$('engine-reviewed-'+event.target.id.slice(12)).checked=false;
  if(['engine-source','engine-effective'].includes(event.target.id))for(const field of Object.keys(definitions))$('engine-reviewed-'+field).checked=false;
  $('engine-confirm').checked=false;$('engine-result').textContent='Entradas alteradas; confirme nova revisão.';
 });
 $('engine-load').addEventListener('click',async()=>{
  try{
   if(!canLoad())throw Error('Context unavailable');
   const selectedContext=context(),interval={window_start:iso('engine-start'),window_end:iso('engine-end')};
   const snapshot=await loadSnapshot(interval);
   if(!active()||JSON.stringify(context())!==JSON.stringify(selectedContext)||iso('engine-start')!==interval.window_start||iso('engine-end')!==interval.window_end)throw Error('Context changed');
   const inspection=OslerEngineReview.inspect(snapshot,selectedContext);
   prepared={snapshot,context:selectedContext,generation};
   $('engine-coverage').textContent=`Snapshot ${snapshot.as_of} · ${snapshot.event_count} eventos / ${snapshot.correction_count} correções · ${inspection.status}. Cobertura somente dos registros armazenados; sem inferir admissão à UTI.`;
   $('engine-result').textContent=inspection.issues.join(' ')||'Consulta preparada. Selecione explicitamente eventos e revise entradas.';
   for(const candidate of inspection.candidates.filter(c=>['weight','creatinine'].includes(c.event.concept))){
    const row=candidate.event,label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=row.id;box.disabled=!candidate.eligible;
    label.append(box,document.createTextNode(` ${row.concept}: ${row.numeric_value} ${row.unit} · medido ${row.measured_at} · criado ${row.created_at} · ${row.source_type} · autor ${row.recorded_by} · evento ${row.id} · ${candidate.reason} · anteriores ${candidate.lineage.join(',')||'nenhum'} · sucessores ${candidate.successors.join(',')||'nenhum'}`));
    $('engine-candidates').append(label,document.createElement('br'));
   }
   $('engine-preview').disabled=inspection.status!=='complete';
  }catch{invalidate();$('engine-result').textContent='Consulta recusada: confira intervalo, contexto, acesso e conexão. Nada foi gravado.';}
 });
 $('engine-preview').addEventListener('click',()=>{
  try{
   if(!active()||!prepared||prepared.generation!==generation)throw Error('Snapshot required');
   const reviewedAt=new Date(Math.max(Date.now(),Date.parse(prepared.snapshot.as_of))).toISOString();
   const supplements=[];
   for(const field of Object.keys(definitions))if($('engine-reviewed-'+field).checked){
    const raw=$('engine-supp-'+field).value;
    const value=field==='age'?(raw===''?NaN:Number(raw)):field==='sex'?raw:raw==='true'?true:raw==='false'?false:null;
    supplements.push({id:crypto.randomUUID(),field,value,unit:OslerEngineReview.fields[field],...prepared.context,confirmed:true,reviewedAt,
     effectiveAt:iso('engine-effective'),source:{type:'synthetic-review',reference:$('engine-source').value.trim()}});
   }
   const report=OslerEngineReview.assess({snapshot:prepared.snapshot,context:prepared.context,selectedIds:[...$('engine-candidates').querySelectorAll('input:checked')].map(e=>e.value),
    supplements,confirmed:$('engine-confirm').checked,assessmentId:crypto.randomUUID(),reviewedAt});
   $('engine-result').textContent=JSON.stringify(report,null,2);
  }catch{$('engine-result').textContent='Prévia recusada: confira seleção, revisão, unidades, horários, origem e contexto.';}
 });
 return {render};
}
root.OslerRemoteEngineUI={create};
})(globalThis);
