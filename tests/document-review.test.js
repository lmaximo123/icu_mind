'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const documents=require('../document-review.js');
const {row}=require('./fixtures/document-fixture.js');
test('parser preserves source values/units and duplicate candidates without guessing times or confidence (text unit test, no OCR)',()=>{
 const c=documents.candidates('Peso: 72 kg\nCreatinina: 88,4 umol/L\nPeso: 73\npH: 7.40\nCreatinina: sem resultado\nFoto 01/01/2026 10:30');
 assert.equal(c.length,4);assert.equal(c[1].rawValue,'88,4');assert.equal(c[1].rawUnit,'umol/L');assert.equal(c[2].rawUnit,null);assert.equal(c[3].rawUnit,null);
 assert.equal(c[1].excerpt,'Creatinina: 88,4 umol/L');assert.equal(c[0].line,1);assert.equal(new Set(c.map(v=>v.key)).size,4);
 for(const candidate of c){assert.equal(candidate.timestamp,undefined);assert.equal(candidate.confidence,undefined);}
});
test('document provenance validates unchanged synthetic fields and demands explicit amendments',()=>{
 const valid=row();assert.equal(documents.validate(valid),valid);const corrected=row();corrected.source.raw_value='72000';corrected.source.raw_unit='g';assert.throws(()=>documents.validate(corrected));corrected.source.amendment_reason='Correção sintética explicitamente revisada';assert.doesNotThrow(()=>documents.validate(corrected));
});
test('missing review/time/unit, crop outside source, unknown/image keys and forged OCR confidence cannot be persisted',()=>{
 for(const change of [{confirmed:false},{timestamp:null},{unit:''},{value:Infinity},{value:NaN}])assert.throws(()=>documents.validate({...row(),...change}));
 for(const change of [{image:'data:image/png;base64,not-allowed'},{confidence:99},{time_source:'photo'},{reviewed_at:null},{crop:{x:1200,y:0,width:1200,height:550}},{original_width:9000},{ocr_version:null}]){const r=row();Object.assign(r.source,change);assert.throws(()=>documents.validate(r));}
});
