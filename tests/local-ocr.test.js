'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
require('../local-ocr.js');
test('mocked OCR cancellation rejects promptly, terminates a worker created later and suppresses stale progress',async()=>{
 let resolveWorker,terminated=0,progress=0,options;
 const runner=globalThis.OslerLocalOCR.createRunner({tesseract:{createWorker:async(_language,_mode,config)=>{options=config;return new Promise(resolve=>{resolveWorker=resolve;});}}});
 const result=runner.recognize('synthetic-pixels',()=>{progress++;});runner.cancel();await assert.rejects(result,error=>error.name==='AbortError');
 resolveWorker({terminate:async()=>{terminated++;},recognize:async()=>{throw Error('Should not run');}});
 await new Promise(resolve=>setImmediate(resolve));options.logger({status:'recognizing text',progress:1});assert.equal(progress,0);assert.equal(terminated,1);
 assert.equal(options.cacheMethod,'none');assert.equal(options.workerPath,'/vendor/worker.min.js');
});
test('mocked OCR returns only actual text/confidence and cleans up worker',async()=>{
 let terminated=0;const runner=globalThis.OslerLocalOCR.createRunner({tesseract:{createWorker:async()=>({recognize:async()=>({data:{text:'Peso: 72 kg'}}),terminate:async()=>{terminated++;}})}});
 const result=await runner.recognize('synthetic');assert.equal(result.confidence,null);assert.equal(result.text,'Peso: 72 kg');assert.equal(terminated,1);
});
test('mocked worker startup failure releases the runner for a later successful retry',async()=>{
 let attempts=0;const runner=globalThis.OslerLocalOCR.createRunner({tesseract:{createWorker:async()=>{if(++attempts===1)throw Error('synthetic worker startup failure');return {recognize:async()=>({data:{text:'synthetic',confidence:81}}),terminate:async()=>{}};}}});
 await assert.rejects(runner.recognize('synthetic'));const result=await runner.recognize('synthetic');assert.equal(result.confidence,81);assert.equal(attempts,2);
});
