/* Pure snapshot/correction/review adapter. No persistence and no authorization bypass. */
(function(root){
'use strict';
const engine=typeof module!=='undefined'&&module.exports?require('./clinical-engine.js'):root.OslerClinicalEngine;
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const time=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const fields=Object.freeze({age:'anos',sex:'original-coefficient',acuteKidney:'boolean',dialysis:'boolean',representativeWeight:'boolean',stableRenal:'boolean',temporalCompatibility:'boolean',clinicalCoverage:'boolean'});
function inspect(snapshot,context){
 if(!snapshot||snapshot.schema_version!==1||snapshot.snapshot_version!=='1.0.0'||snapshot.coverage!=='stored-episode-only'||
  snapshot.unit_id!==context.unitId||snapshot.encounter?.id!==context.encounterId||snapshot.encounter.unit_id!==context.unitId||snapshot.reviewer_id!==context.reviewerId||
  !time(snapshot.as_of)||!time(snapshot.window_start)||!time(snapshot.window_end)||Date.parse(snapshot.window_start)>Date.parse(snapshot.window_end)||Date.parse(snapshot.window_end)>Date.parse(snapshot.as_of)||
  !time(snapshot.encounter.started_at)||Date.parse(snapshot.window_start)<Date.parse(snapshot.encounter.started_at)||
  (snapshot.encounter.ended_at&&Date.parse(snapshot.window_end)>Date.parse(snapshot.encounter.ended_at))||
  !Array.isArray(snapshot.events)||!Array.isArray(snapshot.corrections)||snapshot.row_limit!==1000||
  !Number.isInteger(snapshot.event_count)||!Number.isInteger(snapshot.correction_count)||snapshot.event_count<0||snapshot.correction_count<0||
  snapshot.events.length!==Math.min(snapshot.event_count,1000)||snapshot.corrections.length!==Math.min(snapshot.correction_count,1000)||
  snapshot.complete!==(snapshot.event_count<=1000&&snapshot.correction_count<=1000))throw Error('Invalid snapshot/context');
 if(!snapshot.complete)return {status:'incomplete',candidates:[],issues:['Consulta limitada: nenhum cálculo permitido.']};
 const byId=new Map(),out=new Map(),parent=new Map();
 for(const event of snapshot.events){
  if(!uuid(event.id)||byId.has(event.id)||event.encounter_id!==context.encounterId||event.review_status!=='confirmed'||!event.recorded_by||!time(event.measured_at)||!time(event.created_at)||Date.parse(event.created_at)>Date.parse(snapshot.as_of)||!Number.isFinite(event.numeric_value)||!['manual','device','laboratory','document'].includes(event.source_type))throw Error('Invalid event');
  byId.set(event.id,event);out.set(event.id,[]);
 }
 for(const link of snapshot.corrections){
  const original=byId.get(link.original_event_id),replacement=byId.get(link.replacement_event_id);
  if(!original||!replacement||original.id===replacement.id||original.concept!==replacement.concept||parent.has(replacement.id)||!link.recorded_by||!time(link.created_at)||Date.parse(link.created_at)>Date.parse(snapshot.as_of)||!['transcription','unit','measurement','other'].includes(link.reason_code))throw Error('Invalid correction link');
  out.get(original.id).push(replacement.id);parent.set(replacement.id,original.id);
 }
 const blocked=new Set(),issues=[];
 // Every ambiguous/cyclic connected component is withheld; never pick a branch.
 const visited=new Set();
 for(const id of byId.keys()){
  if(visited.has(id))continue;
  const component=[],queue=[id];let ambiguous=false;
  while(queue.length){const at=queue.pop();if(visited.has(at))continue;visited.add(at);component.push(at);
   const children=out.get(at);if(children.length>1)ambiguous=true;queue.push(...children);if(parent.has(at))queue.push(parent.get(at));
  }
  if(!component.some(at=>!parent.has(at)))ambiguous=true;
  if(ambiguous){component.forEach(at=>blocked.add(at));issues.push('Cadeia de correção ambígua/cíclica; adjudicação necessária.');}
 }
 const candidates=snapshot.events.map(event=>{
  const inWindow=Date.parse(event.measured_at)>=Date.parse(snapshot.window_start)&&Date.parse(event.measured_at)<=Date.parse(snapshot.window_end);
  const lineage=[];let at=event.id;const seen=new Set();while(parent.has(at)&&!seen.has(at)){seen.add(at);at=parent.get(at);lineage.unshift(at);}
  return {event:{...event},lineage,successors:[...out.get(event.id)],eligible:!blocked.has(event.id)&&!out.get(event.id).length&&inWindow,
   reason:blocked.has(event.id)?'correction-conflict':out.get(event.id).length?'superseded':!inWindow?'outside-window':'available'};
 });
 return {status:'complete',candidates,issues};
}
function assess({snapshot,context,selectedIds,supplements=[],confirmed,assessmentId,reviewedAt}){
 if(!uuid(assessmentId)||confirmed!==true||!time(reviewedAt)||Date.parse(reviewedAt)<Date.parse(snapshot?.as_of))throw Error('Review required');
 const inspection=inspect(snapshot,context);
 if(inspection.status!=='complete')return {status:'abstained',reasons:inspection.issues};
 if(!Array.isArray(selectedIds)||new Set(selectedIds).size!==selectedIds.length)throw Error('Invalid selection');
 const selected=selectedIds.map(id=>inspection.candidates.find(c=>c.event.id===id));
 if(selected.some(c=>!c?.eligible))throw Error('Selection superseded, outside interval or conflicted');
 const input={},used=new Set();
 for(const {event} of selected){
  if(!['weight','creatinine'].includes(event.concept)||used.has(event.concept)||event.unit!==engine.catalog.inputs[event.concept])throw Error('Conflicting or incompatible selection');
  used.add(event.concept);input[event.concept]=event.numeric_value;
 }
 const supplementIds=new Set();
 for(const item of supplements){
  if(!uuid(item.id)||supplementIds.has(item.id)||!Object.hasOwn(fields,item.field)||used.has(item.field)||item.unit!==fields[item.field]||item.confirmed!==true||
   item.unitId!==context.unitId||item.encounterId!==context.encounterId||item.reviewerId!==context.reviewerId||
   !time(item.reviewedAt)||Date.parse(item.reviewedAt)>Date.parse(reviewedAt)||Date.parse(item.reviewedAt)<Date.parse(snapshot.as_of)||
   !time(item.effectiveAt)||Date.parse(item.effectiveAt)<Date.parse(snapshot.window_start)||Date.parse(item.effectiveAt)>Date.parse(snapshot.window_end)||
   item.source?.type!=='synthetic-review'||typeof item.source.reference!=='string'||!item.source.reference.trim()||item.source.reference.length>120||
   (item.field==='age'?(!Number.isInteger(item.value)||item.value<0||item.value>120):item.field==='sex'?!['male','female'].includes(item.value):typeof item.value!=='boolean'))throw Error('Invalid supplemental provenance/value');
  supplementIds.add(item.id);used.add(item.field);input[item.field]=item.value;
 }
 const result=engine.calculate(input);
 if(input.clinicalCoverage!==true){delete result.estimate;if(result.status==='included')result.status='abstained';result.reasons.push('Cobertura clínica relevante não confirmada; completude do banco não a demonstra.');}
 return {result,provenance:{assessmentId,reviewedAt,context:{...context},engineVersion:engine.version,adapterVersion:'2.0.0',snapshotVersion:snapshot.snapshot_version,
  snapshotAsOf:snapshot.as_of,windowStart:snapshot.window_start,windowEnd:snapshot.window_end,coverage:'stored-episode-complete',clinicalCoverage:input.clinicalCoverage===true,
  events:selected.map(c=>({event:{...c.event},lineage:[...c.lineage]})),corrections:snapshot.corrections.map(c=>({...c})),supplements:JSON.parse(JSON.stringify(supplements))},
  warning:'Estimativa sintética revisada; sem probabilidade, recomendação de dose ou validação clínica. Válida apenas para o snapshot e intervalo indicados.'};
}
const api={inspect,assess,fields};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OslerEngineReview=api;
})(typeof globalThis!=='undefined'?globalThis:this);
