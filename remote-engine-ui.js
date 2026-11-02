/* Read-only preview. Receives authorized in-memory state, never drafts. */
(function(){
'use strict';
const $=id=>document.getElementById(id);let state,signature='';
for(const entry of OslerClinicalCatalog.entries){
 const item=document.createElement('p');item.textContent=`${entry.id} · ${entry.version} · ${entry.category} · ${entry.status}: ${entry.purpose} Fonte: ${entry.source}`;
 $('engine-catalog').append(item);
}
window.addEventListener('osler-remote-state',event=>{
 state=event.detail;
 $('engine-context').textContent=state.user&&!state.expired?`Unidade ${state.unitId||'não selecionada'} · episódio ${state.encounterId||'não selecionado'}`:'Sem sessão ativa; prévia indisponível.';
 const next=JSON.stringify([state.user?.id,state.expired,state.busy,state.error,state.unitId,state.encounterId,state.observations]);
 if(next===signature)return;signature=next;
 $('engine-result').textContent='Prévia invalidada; revise novamente. Nenhum resultado persistido.';
 $('engine-confirm').checked=false;$('engine-candidates').replaceChildren();
 $('engine-preview').disabled=!state.user||state.expired||state.busy||state.error||!state.encounterId;
 if($('engine-preview').disabled)return;
 for(const row of state.observations.filter(e=>['weight','creatinine'].includes(e.concept))){
  const label=document.createElement('label'),box=document.createElement('input');box.type='checkbox';box.value=row.id;
  label.append(box,document.createTextNode(` ${row.concept}: ${row.numeric_value} ${row.unit} · medido ${row.measured_at} · criado ${row.created_at} · ${row.source_type} · autor ${row.recorded_by} · evento ${row.id}`));
  $('engine-candidates').append(label,document.createElement('br'));
 }
});
$('engine-candidates').addEventListener('change',()=>{$('engine-confirm').checked=false;$('engine-result').textContent='Seleção alterada; confirme nova revisão.';});
$('engine-preview').addEventListener('click',()=>{
 try{
  if(!state||state.expired||state.busy||state.error)throw Error('Contexto indisponível.');
  const report=OslerClinicalEngine.preview({unitId:state.unitId,encounterId:state.encounterId,reviewerId:state.user.id,
   assessmentId:crypto.randomUUID(),encounter:state.encounters.find(e=>e.id===state.encounterId),events:state.observations,selectedIds:[...$('engine-candidates').querySelectorAll('input:checked')].map(e=>e.value),confirmed:$('engine-confirm').checked,asOf:new Date().toISOString()});
  $('engine-result').textContent=JSON.stringify(report,null,2);
 }catch{$('engine-result').textContent='Prévia recusada: confira seleção, revisão, unidades, horários e contexto.';}
});
})();
