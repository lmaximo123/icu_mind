/* Synthetic deterministic cores; no diagnosis, treatment, inference or model runtime. */
(function(root){
'use strict';
function rass(input={}){
 const result={instrument:'rass',version:'2003-table1-osler.1',status:'abstained',reasons:[],limitations:'Exame explícito; sem inferir estado por texto/áudio e sem definir alvo de sedação.'};
 if(input.adult!==true||input.reviewed!==true){result.reasons.push('População adulta e exame revisado precisam de confirmação.');return result;}
 const awake={'calm-alert':0,restless:1,'nonpurposeful-movement':2,'pulls-devices':3,combative:4};
 let score;
 if(Object.hasOwn(awake,input.spontaneous))score=awake[input.spontaneous];
 else if(input.spontaneous==='not-alert'){
  if(input.voice==='eye-contact'){
   if(!Number.isFinite(input.eyeContactSeconds)||input.eyeContactSeconds<=0)result.reasons.push('Duração do contato visual ausente/inválida.');
   else if(input.eyeContactSeconds===10)result.reasons.push('Fronteira de exatamente 10 s não resolvida pela tabela primária (>10 / <10); abstenção conservadora.');
   else score=input.eyeContactSeconds>10?-1:-2;
  }else if(input.voice==='movement-no-eye-contact')score=-3;
  else if(input.voice==='none'){
   if(input.physical==='movement')score=-4;else if(input.physical==='none')score=-5;
   else result.reasons.push('Resposta ao estímulo físico não informada.');
  }else result.reasons.push('Etapa de resposta à voz não informada.');
 }else result.reasons.push('Observação espontânea não informada.');
 if(score!==undefined){result.status='included';result.score=score;result.unit='points';}
 return result;
}
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
function creatininePath({age,reviewed,currentId,baselineId,observations,context}={}){
 const result={instrument:'kdigo-aki',version:'2012-creatinine-path-osler.1',status:'abstained',reasons:[],overallStage:null,
  limitations:'Via creatinina somente: não exclui AKI, não fornece estágio global sem diurese/RRT, não indica terapia. Basal nunca inferida.'};
 if(!Number.isFinite(age)||age<18||reviewed!==true||!context?.unitId||!context.encounterId){result.reasons.push('Escopo adulto, contexto e revisão explícitos necessários.');return result;}
 if(!Array.isArray(observations)||!observations.length||new Set(observations.map(o=>o.id)).size!==observations.length){result.reasons.push('Série ausente/ambígua.');return result;}
 for(const o of observations)if(!o.id||!date(o.measuredAt)||o.unit!=='mg/dL'||o.reviewed!==true||o.unitId!==context.unitId||o.encounterId!==context.encounterId||!Number.isFinite(o.value)||o.value<0.1||o.value>30){result.reasons.push('Observação incompatível ou não revisada.');return result;}
 const current=observations.find(o=>o.id===currentId),baseline=observations.find(o=>o.id===baselineId);
 if(!current){result.reasons.push('Selecione a medição atual explicitamente.');return result;}
 const prior=observations.filter(o=>Date.parse(o.measuredAt)<Date.parse(current.measuredAt));
 if(observations.some(o=>o.id!==currentId&&Date.parse(o.measuredAt)===Date.parse(current.measuredAt))){result.reasons.push('Medições simultâneas conflitantes exigem revisão.');return result;}
 // Floating error tolerance only, scaled to machine epsilon; not a clinical margin.
 const gte=(a,b)=>a>=b||Math.abs(a-b)<=Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b))*4;
 const pairs=prior.filter(o=>Date.parse(current.measuredAt)-Date.parse(o.measuredAt)<=48*3600000&&gte(current.value-o.value,0.3));
 const baselineUsable=!!baseline&&Date.parse(baseline.measuredAt)<Date.parse(current.measuredAt)&&Date.parse(current.measuredAt)-Date.parse(baseline.measuredAt)<=7*86400000;
 const ratio=baselineUsable?current.value/baseline.value:null;
 const acute=pairs.length>0||(ratio!==null&&gte(ratio,1.5));
 let stage=0;
 if(acute){stage=1;if(ratio!==null&&gte(ratio,2))stage=2;if((ratio!==null&&gte(ratio,3))||gte(current.value,4))stage=3;}
 if(!baselineUsable&&!pairs.length){result.reasons.push('Basal explícita no intervalo de 7 dias ou aumento demonstrado em 48 h ausentes.');return result;}
 result.status='partial';result.creatinineStageLowerBound=stage;result.criteriaMet=acute;
 result.evidence={currentId,baselineId:baselineUsable?baselineId:null,increase48hPairs:pairs.map(o=>[o.id,current.id]),ratio7d:ratio};
 result.reasons.push('Diurese e início de RRT não avaliados; resultado é parcial.');
 if(!baselineUsable)result.reasons.push('Basal desconhecida: estágio máximo por creatinina pode ser maior.');
 return result;
}
const api={rass,creatininePath};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OslerClinicalInstruments=api;
})(typeof globalThis!=='undefined'?globalThis:this);
