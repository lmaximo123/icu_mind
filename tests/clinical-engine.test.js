'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const engine=require('../clinical-engine.js');
const valid={age:68,sex:'male',weight:72,creatinine:1,acuteKidney:false,dialysis:false,representativeWeight:true,stableRenal:true,temporalCompatibility:true};
test('Cockcroft-Gault independently hand-derived synthetic cases, not published patient cases',()=>{
 // Original formula: (140-68)*72/(72*1) = 72; original female factor 0.85 = 61.2.
 assert.equal(engine.calculate(valid).estimate.value,72);
 assert.ok(Math.abs(engine.calculate({...valid,sex:'female'}).estimate.value-61.2)<1e-12);
 assert.equal(engine.calculate({...valid,age:40,weight:72,creatinine:2}).estimate.value,50);
 assert.equal(engine.calculate(valid).estimate.unit,'mL/min');
});
test('applicability separates inclusion, exclusion and unknown without imputing normal',()=>{
 assert.equal(engine.calculate(valid).status,'included');
 for(const change of [{age:17},{acuteKidney:true},{dialysis:true},{representativeWeight:false}]){
  const r=engine.calculate({...valid,...change});assert.equal(r.status,'excluded');assert.equal(r.estimate,undefined);
 }
 for(const change of [{stableRenal:undefined},{sex:'unknown'},{creatinine:NaN},{weight:Infinity},{temporalCompatibility:false},{acuteKidney:undefined}]){
  const r=engine.calculate({...valid,...change});assert.equal(r.status,'abstained');assert.equal(r.estimate,undefined);assert.ok(r.reasons.length);
 }
});
const event={id:'event',encounter_id:'episode',recorded_by:'author',review_status:'confirmed',created_at:'2026-01-01T00:00:00Z',measured_at:'2026-01-01T00:00:00Z',concept:'weight',numeric_value:72,unit:'kg',source_type:'manual'};
const input={assessmentId:'12345678-1234-4123-8123-123456789abc',unitId:'unit',encounterId:'episode',reviewerId:'reviewer',encounter:{id:'episode',unit_id:'unit'},events:[event],selectedIds:['event'],confirmed:true,asOf:'2026-01-02T00:00:00Z'};
test('remote preview is traceable, immutable relative to input, abstains without demographics and unresolved corrections',()=>{
 const before=JSON.stringify(input),r=engine.preview(input);
 assert.equal(r.result.status,'abstained');assert.equal(r.result.estimate,undefined);
 assert.equal(r.provenance.unitId,'unit');assert.equal(r.provenance.events[0].recorded_by,'author');
 assert.equal(r.provenance.correctionStatus,'not-resolved');assert.equal(r.provenance.coverage,'loaded-page-only');
 r.provenance.events[0].numeric_value=1;assert.equal(JSON.stringify(input),before);
});
test('remote adapter refuses crossed units/episodes, unknown selection, duplicate concepts, wrong units, unreviewed/future observations',()=>{
 for(const change of [{confirmed:false},{unitId:'other'},{encounterId:'other'},{selectedIds:[]},{selectedIds:['missing']},{selectedIds:['event','event']}])assert.throws(()=>engine.preview({...input,...change}));
 for(const change of [{encounter_id:'other'},{unit:'lb'},{recorded_by:null},{review_status:'pending'},{measured_at:'2027-01-01'},{numeric_value:NaN}])assert.throws(()=>engine.preview({...input,events:[{...event,...change}]}));
 assert.throws(()=>engine.preview({...input,selectedIds:['event','second'],events:[event,{...event,id:'second'}]}));
});
