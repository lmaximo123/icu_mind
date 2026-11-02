'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {assess}=require('../scripts/check-clinical-readiness.js');
const inventory=require('../docs/clinical-release-gates.json');
const copy=()=>JSON.parse(JSON.stringify(inventory));
test('real-data checklist remains blocked despite proven synthetic controls',()=>{
 const report=assess(inventory);assert.equal(report.clinical_release,'blocked');
 assert.equal(report.institutional_authorization,false);
 for(const id of ['hosted_restore','deletion_resistant_copy','permanent_mfa','independent_review'])assert.ok(report.unresolved.some(g=>g.id===id));
});
test('missing mandatory gates, evidence, owners and costs cannot silently pass',()=>{
 let value=copy();value.gates.shift();assert.throws(()=>assess(value));
 value=copy();value.gates[0].state='proven';assert.throws(()=>assess(value));
 value=copy();value.gates[0].cost='';assert.throws(()=>assess(value));
 value=copy();value.gates[0].owner='';assert.throws(()=>assess(value));
 for(const file of ['.env.test','docs/../.env.test','C:\\secrets.json','https://example.com/report.json']){
  value=copy();value.gates[0].evidence=[file];assert.throws(()=>assess(value,{exists:()=>true}));
 }
});
test('checklist cannot authorize clinical use or switch to another project',()=>{
 let value=copy();value.clinical_use_authorized=true;assert.throws(()=>assess(value));
 value=copy();value.project_ref='other-project';assert.throws(()=>assess(value));
 value=copy();for(const g of value.gates){g.state='proven';g.evidence=['docs/security-foundation.md'];}
 assert.equal(assess(value).clinical_release,'blocked');
});
