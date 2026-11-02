'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {inspect}=require('../model-registry.js');
const catalog=require('../clinical-catalog.js');
test('model registry requires outcome, horizon and independent validation, never enables predictions',()=>{
 const empty=inspect({});assert.ok(empty.missing.includes('outcome'));assert.ok(empty.missing.includes('horizon'));
 assert.ok(empty.missing.includes('externalValidationReport'));assert.ok(empty.missing.includes('calibrationReport'));
 const complete=Object.fromEntries(empty.missing.map(k=>[k,'synthetic-metadata']));
 assert.deepEqual(inspect(complete).missing,[]);assert.equal(inspect(complete).status,'disabled');
 assert.equal(inspect(complete).onlineLearning,false);assert.equal(inspect(complete).realDataTraining,false);
});
test('catalog distinguishes verified calculator from candidates and preserves versions against mutation',()=>{
 assert.equal(new Set(catalog.entries.map(e=>e.id)).size,catalog.entries.length);
 for(const e of catalog.entries){for(const key of ['version','category','purpose','population','source','sourceVerification','window'])assert.ok(e[key]);assert.ok(Object.keys(e.inputs).length);assert.ok(e.exclusions.length);}
 assert.equal(catalog.entries.filter(e=>e.status==='synthetic-calculator').length,1);
 assert.equal(catalog.entries.find(e=>e.id==='qsofa').status,'not-enabled-for-icu');
 assert.throws(()=>{catalog.entries[0].version='changed';});
});
