'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {rass,creatininePath}=require('../clinical-instruments.js');
test('RASS primary Table 1 branches yield all ten ordinal values without treatment targets',()=>{
 const base={adult:true,reviewed:true};
 const cases=[['calm-alert',0],['restless',1],['nonpurposeful-movement',2],['pulls-devices',3],['combative',4]];
 for(const [spontaneous,expected] of cases)assert.equal(rass({...base,spontaneous}).score,expected);
 for(const [branch,expected] of [[{voice:'eye-contact',eyeContactSeconds:11},-1],[{voice:'eye-contact',eyeContactSeconds:9},-2],[{voice:'movement-no-eye-contact'},-3],[{voice:'none',physical:'movement'},-4],[{voice:'none',physical:'none'},-5]])assert.equal(rass({...base,spontaneous:'not-alert',...branch}).score,expected);
});
test('RASS abstains for missing examination, exactly 10 seconds, unknown stages and unsupported population',()=>{
 for(const input of [{},{adult:false,reviewed:true},{adult:true,reviewed:false},{adult:true,reviewed:true,spontaneous:'not-alert'},{adult:true,reviewed:true,spontaneous:'not-alert',voice:'eye-contact',eyeContactSeconds:10}]){assert.equal(rass(input).status,'abstained');assert.equal(rass(input).score,undefined);}
});
const context={unitId:'unit',encounterId:'episode'};
const observation=(day,value,id='day'+day)=>({id,measuredAt:new Date(Date.UTC(2026,0,1)+day*86400000).toISOString(),value,unit:'mg/dL',reviewed:true,...context});
test('KDIGO guideline Table 10 synthetic cases A–E match published maximum creatinine stages with explicit baseline',()=>{
 // Guideline chapter 2.4, Table 10, page 30. These are constructed examples, not patient records.
 const cases=[[[1,1.3,1.5,2],null,2],[[1,1.1,1.2,1.4],null,1],[[.4,.5,.6,.7],null,1],[[1,1.1,1.2,1.3],1.5,1],[[1,1.3,1.5,1.8],2.2,2]];
 for(const [values,day7,expected] of cases){
  const observations=values.map((v,day)=>observation(day,v));if(day7!==null)observations.push(observation(7,day7));
  let peak=0;for(const current of observations.slice(1)){const result=creatininePath({age:50,reviewed:true,currentId:current.id,baselineId:'day0',observations,context});peak=Math.max(peak,result.creatinineStageLowerBound||0);assert.equal(result.overallStage,null);}
  assert.equal(peak,expected);
 }
});
test('KDIGO boundaries: 48 h and 7 d included, beyond excluded; stable high creatinine does not imply acute stage 3',()=>{
 const run=(observations,baselineId='day0')=>creatininePath({age:50,reviewed:true,currentId:observations.at(-1).id,baselineId,observations,context});
 assert.equal(run([observation(0,1),observation(2,1.3)]).creatinineStageLowerBound,1);
 assert.equal(run([observation(0,1),observation(2+1/86400000,1.3)]).criteriaMet,false);
 assert.equal(run([observation(0,1),observation(7,1.5)]).creatinineStageLowerBound,1);
 assert.equal(run([observation(0,1),observation(7+1/86400000,1.5)]).status,'abstained');
 assert.equal(run([observation(0,4),observation(1,4)]).criteriaMet,false);
 assert.equal(run([observation(0,1),observation(1,4)]).creatinineStageLowerBound,3);
 assert.equal(run([observation(0,1),observation(1,3)]).creatinineStageLowerBound,3);
 assert.equal(run([observation(0,1),observation(1,1.3)],'unknown').creatinineStageLowerBound,1);
 assert.equal(run([observation(0,1),observation(1,1.1)],'unknown').status,'abstained');
});
test('KDIGO fails closed for mixed context, wrong units, ambiguous series, missing review and paediatric scope',()=>{
 const base={age:50,reviewed:true,currentId:'day1',baselineId:'day0',observations:[observation(0,1),observation(1,2)],context};
 for(const change of [{age:17},{reviewed:false},{currentId:'unknown'},{observations:[{...observation(0,1),unit:'umol/L'},observation(1,2)]},{context:{...context,unitId:'other'}},{observations:[observation(0,1),observation(1,2),observation(1,3,'conflict')]}])assert.equal(creatininePath({...base,...change}).status,'abstained');
});
