'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {evaluate,validateSplit}=require('../synthetic-model-evaluation.js');
const config={syntheticOnly:true,outcome:'synthetic-event',horizonHours:24,modelVersion:'synthetic-fixture-1',asOf:'2026-01-03T00:00:00Z',records:[
 {id:'a',syntheticSubjectId:'a',probability:.1,observed:0,predictedAt:'2026-01-01T00:00:00Z',followupThrough:'2026-01-02T00:00:00Z'},
 {id:'b',syntheticSubjectId:'b',probability:.9,observed:1,predictedAt:'2026-01-01T00:00:00Z',followupThrough:'2026-01-02T00:00:00Z',eventAt:'2026-01-01T12:00:00Z'}]};
test('synthetic supplied values have independently derived Brier/reliability diagnostics without model fitting or release',()=>{
 const r=evaluate(config);assert.ok(Math.abs(r.brier-.01)<1e-12);assert.ok(Math.abs(r.expectedCalibrationError-.1)<1e-12);
 assert.equal(r.meanPrediction,.5);assert.equal(r.observedFraction,.5);assert.equal(r.reliability.reduce((n,b)=>n+b.count,0),2);
 assert.equal(r.clinicalRelease,'blocked');assert.equal(r.calibrationSlope,null);
});
test('evaluation refuses missing horizon, real-data flag, censored followup, out-of-horizon labels, invalid probabilities and duplicates',()=>{
 for(const change of [{syntheticOnly:false},{outcome:''},{horizonHours:undefined},{records:[]},{records:[{...config.records[0],probability:1.1}]},{records:[{...config.records[0],followupThrough:'2026-01-01T01:00:00Z'}]},{records:[{...config.records[1],eventAt:'2026-01-03T00:00:00Z'}]},{records:[config.records[0],config.records[0]]}])assert.throws(()=>evaluate({...config,...change}));
});
test('temporal/external structural validation rejects overlap and subject leakage, never claims clinical validation',()=>{
 const training=[{id:'a',syntheticSubjectId:'a',site:'site-a',at:'2026-01-01T00:00:00Z'}],validation=[{id:'b',syntheticSubjectId:'b',site:'site-b',at:'2026-02-01T00:00:00Z'}];
 assert.equal(validateSplit({kind:'temporal',training,validation}).clinicalValidation,'not-performed');
 assert.equal(validateSplit({kind:'external',training,validation}).structuralChecks,'passed');
 for(const [kind,change] of [['temporal',{at:'2025-01-01T00:00:00Z'}],['external',{site:'site-a'}],['external',{syntheticSubjectId:'a'}],['temporal',{id:'a'}]])assert.throws(()=>validateSplit({kind,training,validation:[{...validation[0],...change}]}));
});
