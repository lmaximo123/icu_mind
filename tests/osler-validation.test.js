'use strict';
const assert=require('node:assert/strict');
const test=require('node:test');
const V=require('../osler-validation.js');
const stamp=new Date(Date.now()-60000).toISOString();
const obs=(value,unit,extra={})=>({value,unit,confirmed:true,timestamp:stamp,bed:'01',...extra});
test('confirmed plausible data passes',()=>{
 const result=V.validate({ph:obs(7.4,''),fio2:obs(.3,'fraction')});
 assert.equal(result.reviewRequired,false);
 assert.equal(Object.keys(result.accepted).length,2);
});
test('unconfirmed data cannot be accepted',()=>{
 const r=V.validate({ph:obs(7.4,'',{confirmed:false})});
 assert.equal(r.accepted.ph,undefined);assert.equal(r.issues[0].code,'unconfirmed');
});
test('wrong unit and out-of-range values are blocked',()=>{
 const r=V.validate({fio2:obs(30,'%'),ph:obs(9,'')});
 assert.equal(Object.keys(r.accepted).length,0);
 assert.deepEqual(r.issues.map(x=>x.code),['unit','range']);
});
test('missing timestamps and future timestamps are blocked',()=>{
 const r=V.validate({ph:obs(7.4,'',{timestamp:null}),spo2:obs(97,'%',{timestamp:new Date(Date.now()+3600000).toISOString()})});
 assert.deepEqual(r.issues.map(x=>x.code),['timestamp','future']);
});
test('PAM greater than PAS is flagged',()=>{
 const r=V.validate({map:obs(130,'mmHg'),sbp:obs(110,'mmHg')});
 assert.equal(r.accepted.map,undefined);assert.equal(r.reviewRequired,true);
});
test('fluid balance arithmetic is checked',()=>{
 assert.equal(V.checkFluidBalance(1620,1100,520).valid,true);
 assert.equal(V.checkFluidBalance(1620,1100,870).valid,false);
 assert.equal(V.checkFluidBalance(1620,-10,1630).valid,false);
 assert.equal(V.checkFluidBalance(null,1100,520).valid,false);
});
