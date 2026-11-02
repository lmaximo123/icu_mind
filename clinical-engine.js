/* Deterministic synthetic research engine. No storage or inference. */
(function(root){
'use strict';
const version='1.0.0';
const catalog=Object.freeze({id:'cockcroft-gault',version:'1976-osler.1',category:'physiologic-estimation',
 purpose:'Estimativa de clearance de creatinina; sem dose ou probabilidade.',
 population:'Adultos com função renal estável; adequação exige revisão.',
 source:'https://doi.org/10.1159/000180580',verified:'2026-11-02',
 inputs:Object.freeze({age:'anos',sex:'male|female (coeficiente original)',weight:'kg',creatinine:'mg/dL'}),
 exclusions:Object.freeze(['idade <18','lesão renal aguda','diálise','peso não representativo']),
 window:'Sem horizonte prognóstico. Compatibilidade temporal e estabilidade precisam de confirmação explícita.',
 limitations:'Não equivale a GFR medida; peso e coeficiente por sexo exigem avaliação; sem recomendações terapêuticas.'});
function applicability(input={}){
 if(!input||typeof input!=='object'||Array.isArray(input))return {status:'abstained',reasons:['Entrada estruturada ausente ou inválida.']};
 const excluded=[],missing=[];
 if(Number.isFinite(input.age)&&input.age<18)excluded.push('População pediátrica fora do escopo.');
 for(const [key,label] of [['acuteKidney','Lesão renal aguda'],['dialysis','Diálise']]){
  if(input[key]===true)excluded.push(label+'.');else if(input[key]!==false)missing.push(label+': ausência não confirmada.');
 }
 if(input.representativeWeight===false)excluded.push('Peso não representativo.');
 else if(input.representativeWeight!==true)missing.push('Adequação do peso não confirmada.');
 if(input.stableRenal!==true)missing.push('Estabilidade renal não confirmada.');
 if(input.temporalCompatibility!==true)missing.push('Compatibilidade temporal não confirmada.');
 for(const [key,min,max] of [['age',18,120],['weight',1,500],['creatinine',0.1,30]]){
  if(!Number.isFinite(input[key])||input[key]<min||input[key]>max)missing.push(key+': ausente ou fora dos limites técnicos.');
 }
 if(!['male','female'].includes(input.sex))missing.push('Coeficiente por sexo não informado.');
 return {status:excluded.length?'excluded':missing.length?'abstained':'included',reasons:[...excluded,...missing]};
}
function calculate(input){
 const decision=applicability(input);
 const result={instrument:catalog.id,instrumentVersion:catalog.version,engineVersion:version,...decision,limitations:catalog.limitations};
 if(decision.status==='included')result.estimate={value:(140-input.age)*input.weight/(72*input.creatinine)*(input.sex==='female'?0.85:1),unit:'mL/min'};
 return result;
}
function preview({unitId,encounterId,reviewerId,encounter,events,selectedIds,confirmed,asOf,assessmentId}){
 if(typeof assessmentId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assessmentId))throw Error('ID de revisão necessário.');
 if(encounter?.id!==encounterId||encounter?.unit_id!==unitId||!unitId||!encounterId||!reviewerId||confirmed!==true||!Number.isFinite(Date.parse(asOf)))throw Error('Revisão e contexto explícitos necessários.');
 if(!Array.isArray(events)||!Array.isArray(selectedIds)||!selectedIds.length||new Set(selectedIds).size!==selectedIds.length)throw Error('Seleção inválida.');
 const selected=selectedIds.map(id=>{
  const matches=events.filter(e=>e.id===id);if(matches.length!==1)throw Error('Evento ausente ou ambíguo.');return matches[0];
 });
 const input={},seen=new Set();
 for(const e of selected){
  if(e.encounter_id!==encounterId||(e.unit_id!==undefined&&e.unit_id!==unitId)||e.review_status!=='confirmed'||!e.recorded_by||!e.source_type||
   !Number.isFinite(Date.parse(e.created_at))||!Number.isFinite(Date.parse(e.measured_at))||Date.parse(e.measured_at)>Date.parse(asOf)||
   !['weight','creatinine'].includes(e.concept)||e.unit!==catalog.inputs[e.concept]||!Number.isFinite(e.numeric_value)||seen.has(e.concept))throw Error('Evento incompatível ou conflitante.');
  if((e.concept==='weight'&&(e.numeric_value<1||e.numeric_value>500))||(e.concept==='creatinine'&&(e.numeric_value<0.1||e.numeric_value>30)))throw Error('Valor fora dos limites técnicos.');
  seen.add(e.concept);input[e.concept]=e.numeric_value;
 }
 return {result:calculate(input),provenance:{assessmentId,unitId,encounterId,reviewerId,asOf,engineVersion:version,
  coverage:'loaded-page-only',correctionStatus:'not-resolved',events:selected.map(e=>({...e}))},
  warning:'Prévia parcial: demografia, exclusões, estabilidade e vínculos de correção pendentes. Nenhum resultado numérico remoto liberado.'};
}
const api={version,catalog,applicability,calculate,preview};
if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OslerClinicalEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this);
