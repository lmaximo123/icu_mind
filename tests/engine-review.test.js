'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const review=require('../engine-review.js');
const context={unitId:'unit',encounterId:'episode',reviewerId:'reviewer'};
const event=(concept,value,unit)=>({id:randomUUID(),encounter_id:'episode',recorded_by:'author',review_status:'confirmed',created_at:'2026-01-01T12:00:00Z',measured_at:'2026-01-01T11:00:00Z',concept,numeric_value:value,unit,source_type:'manual'});
function fixture(){
 const events=[event('weight',72,'kg'),event('creatinine',1,'mg/dL')];
 const snapshot={schema_version:1,snapshot_version:'1.0.0',coverage:'stored-episode-only',unit_id:'unit',encounter:{id:'episode',unit_id:'unit',started_at:'2026-01-01T00:00:00Z',ended_at:null},reviewer_id:'reviewer',as_of:'2026-01-01T13:00:00Z',window_start:'2026-01-01T00:00:00Z',window_end:'2026-01-01T12:00:00Z',row_limit:1000,event_count:2,correction_count:0,complete:true,events,corrections:[]};
 const values={age:68,sex:'male',acuteKidney:false,dialysis:false,representativeWeight:true,stableRenal:true,temporalCompatibility:true,clinicalCoverage:true};
 const supplements=Object.entries(values).map(([field,value])=>({id:randomUUID(),field,value,unit:review.fields[field],...context,confirmed:true,reviewedAt:'2026-01-01T14:00:00Z',effectiveAt:'2026-01-01T11:00:00Z',source:{type:'synthetic-review',reference:'synthetic fixture'}}));
 return {snapshot,context,selectedIds:events.map(e=>e.id),supplements,confirmed:true,assessmentId:randomUUID(),reviewedAt:'2026-01-01T14:00:00Z'};
}
function link(snapshot,original,replacement){snapshot.events.push(replacement);snapshot.event_count++;snapshot.corrections.push({original_event_id:original.id,replacement_event_id:replacement.id,recorded_by:'author',created_at:'2026-01-01T12:00:00Z',reason_code:'measurement'});snapshot.correction_count++;}
test('complete stored snapshot and independently reviewed supplements yield traceable CG, not a probability',()=>{
 const f=fixture(),before=JSON.stringify(f),report=review.assess(f);
 assert.equal(report.result.estimate.value,72);assert.equal(report.result.status,'included');assert.equal(report.provenance.supplements.length,8);
 assert.equal(report.provenance.snapshotAsOf,f.snapshot.as_of);assert.equal(report.provenance.events.length,2);assert.equal(report.result.probability,undefined);
 report.provenance.supplements[0].source.reference='changed';assert.equal(JSON.stringify(f),before);
});
test('linear corrections preserve ancestry, prohibit original, never automatically select leaf and track moved times',()=>{
 const f=fixture(),original=f.snapshot.events[1],second={...original,id:randomUUID(),numeric_value:2},third={...original,id:randomUUID(),numeric_value:3};link(f.snapshot,original,second);link(f.snapshot,second,third);
 const inspected=review.inspect(f.snapshot,context);assert.equal(inspected.candidates.find(c=>c.event.id===original.id).reason,'superseded');
 assert.throws(()=>review.assess(f));f.selectedIds=[f.selectedIds[0],third.id];const r=review.assess(f);
 assert.equal(r.result.estimate.value,24);assert.deepEqual(r.provenance.events[1].lineage,[original.id,second.id]);
 third.measured_at='2026-01-01T12:30:00Z';assert.throws(()=>review.assess(f));
});
test('forks and cycles withhold entire component; dangling links and context mismatch fail closed',()=>{
 let f=fixture(),o=f.snapshot.events[1];link(f.snapshot,o,{...o,id:randomUUID()});link(f.snapshot,o,{...o,id:randomUUID()});
 assert.equal(review.inspect(f.snapshot,context).candidates.filter(c=>c.event.concept==='creatinine'&&c.eligible).length,0);
 f=fixture();o=f.snapshot.events[1];const n={...o,id:randomUUID()};link(f.snapshot,o,n);f.snapshot.corrections.push({original_event_id:n.id,replacement_event_id:o.id,recorded_by:'author',created_at:'2026-01-01T12:00:00Z',reason_code:'other'});f.snapshot.correction_count++;
 assert.ok(review.inspect(f.snapshot,context).issues.length);assert.throws(()=>review.assess(f));
 f=fixture();f.snapshot.corrections=[{original_event_id:'missing'}];f.snapshot.correction_count=1;assert.throws(()=>review.assess(f));
 assert.throws(()=>review.inspect(fixture().snapshot,{...context,unitId:'other'}));
});
test('incomplete snapshots and unknown clinical coverage cannot emit numeric estimates',()=>{
 let f=fixture();f.snapshot.events=Array.from({length:1000},()=>event('weight',72,'kg'));f.snapshot.event_count=1001;f.snapshot.complete=false;
 assert.equal(review.assess(f).status,'abstained');
 f=fixture();f.supplements=f.supplements.filter(s=>s.field!=='clinicalCoverage');assert.equal(review.assess(f).result.estimate,undefined);
 f=fixture();f.supplements.find(s=>s.field==='acuteKidney').value=true;assert.equal(review.assess(f).result.status,'excluded');
 f=fixture();f.snapshot.event_count=10;assert.throws(()=>review.assess(f));
});
test('supplementary provenance rejects different reviewer/context, unreviewed, wrong unit/type, duplicate and invalid temporal/source data',()=>{
 for(const change of [{reviewerId:'other'},{encounterId:'other'},{unitId:'other'},{confirmed:false},{unit:'kg'},{value:'68'},{source:{type:'unknown',reference:'x'}},{effectiveAt:'2025-12-31T00:00:00Z'},{reviewedAt:'2027-01-01T00:00:00Z'}]){
  const f=fixture();Object.assign(f.supplements[0],change);assert.throws(()=>review.assess(f));
 }
 const f=fixture();f.supplements.push({...f.supplements[0],id:randomUUID()});assert.throws(()=>review.assess(f));
});
module.exports={fixture};
