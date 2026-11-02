'use strict';
// Real Chrome canvas/file/camera/Tesseract + real authorized Auth/RPC; only lost HTTP reply is injected.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {randomUUID}=require('node:crypto');
module.exports=async function({evaluate,change,click,waitFor,until,send,login,logout,selectUnit,selectEpisode,browserApi,users,fixtures,localDrafts,checkDrafts,draftsBefore,documentWrites,documentBodies,externalOrigins,securityEvents,localDate,setStage}){
 const evidence=[];
 const fixtureDirectory='.test-artifacts/ocr-fixtures-'+randomUUID();await fs.mkdir(fixtureDirectory,{recursive:true});
 async function upload(type,format='image/png'){
  const encoded=await evaluate(`(async()=>{const fixture=await OslerSyntheticImages.create(${JSON.stringify(type)},${JSON.stringify(format)});const transfer=new DataTransfer();transfer.items.add(new File([fixture.blob],'synthetic-document.'+${JSON.stringify(format.split('/')[1])},{type:fixture.blob.type}));const input=document.getElementById('doc-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(fixture.blob);});})()`);
  await fs.writeFile(fixtureDirectory+'/'+type+'.'+format.split('/')[1],Buffer.from(encoded,'base64'));
  await waitFor(`!document.getElementById('doc-ocr').disabled && document.getElementById('doc-status').textContent.includes('Imagem aberta')`);
 }
 async function ocr(){await click('doc-ocr');await waitFor(`!document.getElementById('doc-ocr').disabled && document.getElementById('doc-status').textContent.startsWith('OCR concluído')`);}
 async function adjustRotated(){for(let i=0;i<3;i++)await click('doc-rotate');for(const [key,value] of Object.entries({x:20,y:90,width:1160,height:290}))await change('doc-crop-'+key,String(value));assert.equal(await evaluate(`document.getElementById('doc-ocr').disabled`),true);await click('doc-crop');}
 const fields=()=>evaluate(`Array.from(document.querySelectorAll('#doc-candidates fieldset')).map(box=>({index:Number(box.dataset.index),concept:box.dataset.concept,value:box.querySelector('[data-field=value]').value,unit:box.querySelector('[data-field=unit]').value,time:box.querySelector('[data-field=time]').value,checked:box.querySelector('[data-field=reviewed]').checked}))`);
 setStage('document real image variants and extraction');await login(users[1]);
 for(const [type,format] of [['laboratory','image/png'],['laboratory','image/jpeg'],['laboratory','image/webp'],['monitor','image/png'],['different-units','image/png'],['missing','image/png'],['low-quality','image/jpeg'],['rotated','image/png']]){
  await upload(type,format);
  if(type==='rotated'){
   await adjustRotated();
  }
  await ocr();const candidates=await fields();assert.ok(candidates.every(c=>!c.checked&&!c.time));
  assert.equal(await evaluate(`document.getElementById('doc-photo-at').value`),'');assert.equal(await evaluate(`document.getElementById('doc-document-at').value`),'');
  if(['laboratory','rotated'].includes(type)){
   assert.ok(candidates.some(c=>c.concept==='weight'&&Number(c.value)===72&&c.unit==='kg'));
   assert.ok(candidates.some(c=>c.concept==='creatinine'&&Number(c.value)===1&&c.unit==='mg/dL'));
  }
  if(type==='monitor')assert.ok(candidates.some(c=>c.concept==='sbp'&&Number(c.value)===120&&c.unit==='mmHg'));
  if(type==='different-units'){assert.ok(candidates.some(c=>c.concept==='weight'&&Number(c.value)===72000&&c.unit==='g'));assert.ok(candidates.some(c=>c.concept==='creatinine'&&Number(c.value)===88.4&&c.unit!=='mg/dL'));}
  if(type==='missing'){assert.ok(candidates.some(c=>c.concept==='weight'&&c.unit===''));assert.ok(!candidates.some(c=>c.concept==='creatinine'));}
  const known=candidates.filter(c=>(c.concept==='weight'&&[72,72000].includes(Number(c.value)))||(c.concept==='creatinine'&&[1,88.4].includes(Number(c.value)))||(c.concept==='sbp'&&Number(c.value)===120));
  evidence.push({type,format,ocr:'real-tesseract-5.1.1-por',candidateCount:candidates.length,candidateConcepts:candidates.map(c=>c.concept),knownValueMatches:known.length,unchecked:true,measurementTimesAbsent:true});
  assert.equal(documentWrites(),0);checkDrafts(await localDrafts(),draftsBefore);
 }
 console.log('PASS: real local OCR on PNG/JPEG/WebP, monitor, different units, missing fields, low-quality and rotated/cropped fixtures; source values preserved, no reviews/times invented or drafts changed.');
 setStage('document cancellation, malformed file and native synthetic camera');
 await upload('laboratory');await click('doc-ocr');await click('doc-cancel');
 await waitFor(`!document.getElementById('doc-ocr').disabled`);assert.equal(await evaluate(`document.getElementById('doc-text').value`),'');
 await evaluate(`(()=>{const transfer=new DataTransfer();transfer.items.add(new File(['not an image'],'invalid.png',{type:'image/png'}));const input=document.getElementById('doc-file');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await waitFor(`document.getElementById('doc-status').textContent.startsWith('Não foi possível abrir')`);assert.equal(await evaluate(`document.getElementById('doc-original').hasAttribute('src')`),false);
 await upload('laboratory');await evaluate(`window.__realOCRWorkerFactory=Tesseract.createWorker;Tesseract.createWorker=async()=>{throw new Error('private-image-startup-detail');}`);
 try{await click('doc-ocr');await waitFor(`document.getElementById('doc-status').textContent.startsWith('Falha no OCR local') && !document.getElementById('doc-ocr').disabled`);assert.ok(!(await evaluate(`document.getElementById('doc-status').textContent`)).includes('private-image'));assert.equal(await evaluate(`document.getElementById('doc-text').value`),'');}
 finally{await evaluate(`Tesseract.createWorker=window.__realOCRWorkerFactory;delete window.__realOCRWorkerFactory;`);}
 await evaluate(`window.__realCameraFactory=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=async()=>{throw new DOMException('synthetic permission denied','NotAllowedError');}`);
 try{await click('doc-camera');await waitFor(`document.getElementById('doc-status').textContent.startsWith('Não foi possível acessar a câmera')`);}
 finally{await evaluate(`navigator.mediaDevices.getUserMedia=window.__realCameraFactory;delete window.__realCameraFactory;`);}
 await click('doc-camera');await waitFor(`!document.getElementById('doc-capture').hidden && document.getElementById('doc-video').videoWidth>0`);
 await evaluate(`window.__syntheticCameraTrack=document.getElementById('doc-video').srcObject.getVideoTracks()[0]`);
 await click('doc-capture');await waitFor(`!document.getElementById('doc-ocr').disabled && document.getElementById('doc-status').textContent.includes('Imagem aberta')`);
 assert.equal(await evaluate(`window.__syntheticCameraTrack.readyState`),'ended');assert.equal(await evaluate(`document.getElementById('doc-video').srcObject`),null);
 assert.ok(await evaluate(`document.getElementById('doc-captured-at').textContent.includes('Quadro capturado')`));assert.equal(await evaluate(`document.getElementById('doc-photo-at').value`),'');
 await click('doc-clear');assert.equal(documentWrites(),0);
 console.log('PASS: real OCR cancellation/invalid PNG, explicitly mocked worker/permission errors, native getUserMedia fake-device capture and track shutdown; capture time kept separate. Physical camera not tested.');
 setStage('document context invalidation and explicit reviewed upload');
 await selectUnit(fixtures.unitA);await change('remote-bed','987');await click('remote-create-button');await waitFor(`document.getElementById('remote-status').textContent.includes('Novo episódio confirmado')`);
 const episodeId=await evaluate(`document.getElementById('remote-encounter').value`);
 const info=(await browserApi('/api/encounters?unit_id='+fixtures.unitA)).body.find(e=>e.id===episodeId);
 await until(()=>Date.now()>Math.ceil(Date.parse(info.started_at)/1000)*1000+20);
 for(const type of ['different-units','missing']){
  await upload(type);await ocr();const candidate=(await fields()).find(c=>c.concept==='weight');assert.ok(candidate);
  await change(`doc-field-${candidate.index}-time`,localDate(new Date().toISOString()).slice(0,19));await click(`doc-field-${candidate.index}-reviewed`);
  await evaluate(`document.getElementById('doc-send-confirm').checked=true`);await click('doc-send');
  assert.ok(await evaluate(`document.getElementById('doc-status').textContent.includes('Envio bloqueado')`));assert.equal(documentWrites(),0);
 }
 await upload('rotated');await adjustRotated();await ocr();let candidates=await fields();
 const weight=candidates.find(c=>c.concept==='weight'),creatinine=candidates.find(c=>c.concept==='creatinine');assert.ok(weight&&creatinine);
 await click(`doc-field-${weight.index}-reviewed`);await change('remote-unit','');
 assert.equal(await evaluate(`document.getElementById('doc-field-${weight.index}-reviewed').checked`),false);
 await selectUnit(fixtures.unitA);await selectEpisode(episodeId);
 assert.equal(documentWrites(),0);await evaluate(`document.getElementById('doc-send-confirm').checked=true`);await click('doc-send');
 assert.ok(await evaluate(`document.getElementById('doc-status').textContent.includes('Envio bloqueado')`));assert.equal(documentWrites(),0);
 const measurement=new Date().toISOString();
 for(const candidate of [weight,creatinine]){await change(`doc-field-${candidate.index}-time`,localDate(measurement).slice(0,19));await click(`doc-field-${candidate.index}-reviewed`);}
 await evaluate(`document.getElementById('doc-send-confirm').checked=true`);await click('doc-send');
 await waitFor(`document.getElementById('doc-batch').textContent.includes('uncertain') && !document.getElementById('doc-retry').disabled`);
 assert.equal(documentWrites(),2);assert.ok(await evaluate(`document.getElementById('doc-batch').textContent.includes('confirmed')`));
 assert.equal(await evaluate(`document.getElementById('remote-unit').disabled`),true);
 assert.equal(await evaluate(`document.getElementById('doc-file').disabled`),true);
 assert.ok(await evaluate(`Array.from(document.querySelectorAll('#doc-candidates input')).every(input=>input.disabled)`));
 await click('doc-verify');await waitFor(`!document.getElementById('remote-refresh').disabled`);
 // One injected read outage cannot turn uncertain writes into failures or new IDs.
 assert.ok((await evaluate(`document.getElementById('doc-batch').textContent`)).includes('uncertain'));
 await click('doc-retry');assert.equal(documentWrites(),2);
 await evaluate(`document.getElementById('doc-retry-confirm').checked=true`);await click('doc-retry');
 await waitFor(`document.getElementById('doc-batch').textContent.includes('confirmed') && !document.getElementById('doc-batch').textContent.includes('uncertain') && !document.getElementById('remote-refresh').disabled`);
 assert.equal(documentWrites(),3);assert.equal(documentBodies[1].event_id,documentBodies[2].event_id);assert.deepEqual(documentBodies[1],documentBodies[2]);
 assert.equal(await evaluate(`document.getElementById('doc-original').hasAttribute('src')`),false);assert.equal(await evaluate(`document.getElementById('doc-text').value`),'');
 const rows=(await browserApi('/api/observations?encounter_id='+episodeId)).body;assert.equal(rows.length,2);assert.ok(rows.every(row=>row.source_type==='document'));
 const receipts=(await browserApi('/api/document-observations?encounter_id='+episodeId)).body;assert.equal(receipts.length,2);
 for(const receipt of receipts){assert.equal(receipt.metadata.photo_at,null);assert.equal(receipt.metadata.document_at,null);assert.equal(receipt.metadata.captured_at,null);assert.equal(receipt.metadata.time_source,'reviewer');assert.match(receipt.metadata.image_sha256,/^[a-f0-9]{64}$/);assert.notEqual(receipt.metadata.adjusted_sha256,receipt.metadata.image_sha256);assert.equal(receipt.metadata.rotation,270);assert.deepEqual(receipt.metadata.crop,{x:20,y:90,width:1160,height:290});assert.equal(receipt.event.encounter_id,episodeId);}
 // Exact direct RPC/API retry simulates repeated delivery, proving no duplicate event/source.
 const body=documentBodies[1],repeat={id:body.event_id,unit_id:body.target_unit,encounter_id:body.target_encounter,concept:body.observation_concept,value:body.observation_value,unit:body.observation_unit,timestamp:body.observation_time,confirmed:true,source:body.source};
 assert.equal((await browserApi('/api/document-observations','POST',repeat)).status,200);
 assert.equal((await browserApi('/api/observations?encounter_id='+episodeId)).body.length,2);
 assert.equal((await browserApi('/api/document-observations?encounter_id='+episodeId)).body.length,2);
 for(const sent of documentBodies){assert.equal(sent.source.image,undefined);assert.equal(sent.source.text,undefined);assert.ok(!JSON.stringify(sent).includes('data:image'));}
 checkDrafts(await localDrafts(),draftsBefore);
 console.log('PASS: real Auth/API/RPC save of two OCR-reviewed fields, injected lost reply/read outage, partial confirmations and explicit identical UI retry without duplicates; scalar provenance retained and images cleared.');
 setStage('document persistence, reader isolation and engine preview');
 await logout();await login(users[0]);await selectUnit(fixtures.unitA);await selectEpisode(episodeId);
 assert.equal((await browserApi('/api/document-observations?encounter_id='+episodeId)).body.length,2);
 assert.equal((await browserApi('/api/document-observations','POST',{...repeat,id:randomUUID()})).status,403);
 await logout();await login(users[2]);await selectUnit(fixtures.unitB);
 assert.deepEqual((await browserApi('/api/document-observations?encounter_id='+episodeId)).body,[]);
 assert.equal((await browserApi('/api/document-observations','POST',{...repeat,id:randomUUID(),unit_id:fixtures.unitB})).status,403);
 await logout();await login(users[1]);await selectUnit(fixtures.unitA);await selectEpisode(episodeId);
 await change('engine-start',localDate(new Date(Math.ceil(Date.parse(info.started_at)/1000)*1000).toISOString()));await change('engine-end',localDate(new Date().toISOString()));await click('engine-load');
 await waitFor(`!document.getElementById('engine-preview').disabled`);
 for(const row of rows)await evaluate(`document.querySelector('#engine-candidates input[value="${row.id}"]').click()`);
 await evaluate(`document.getElementById('engine-confirm').checked=true`);await click('engine-preview');
 let result=JSON.parse(await evaluate(`document.getElementById('engine-result').textContent`));assert.equal(result.result.status,'abstained');assert.equal(result.result.estimate,undefined);
 await change('engine-source','synthetic-ocr-instrument-review');await change('engine-effective',localDate(measurement));
 for(const [field,value] of Object.entries({age:'68',sex:'male',acuteKidney:'false',dialysis:'false',representativeWeight:'true',stableRenal:'true',temporalCompatibility:'true',clinicalCoverage:'true'})){await change('engine-supp-'+field,value);await click('engine-reviewed-'+field);}
 await evaluate(`document.getElementById('engine-confirm').checked=true`);await click('engine-preview');result=JSON.parse(await evaluate(`document.getElementById('engine-result').textContent`));
 assert.equal(result.result.estimate.value,72);assert.equal(result.provenance.events.length,2);assert.ok(result.provenance.events.every(r=>r.event.source_type==='document'));
 await click('doc-receipts');await waitFor(`document.getElementById('doc-receipt-list').textContent.includes('image_sha256')`);
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 assert.equal(await evaluate(`document.getElementById('doc-file').disabled`),false);
 assert.ok(await evaluate(`document.getElementById('document-flow').getBoundingClientRect().width<=innerWidth`));
 await send('Emulation.clearDeviceMetricsOverride');
 await click('remote-close');await waitFor(`document.getElementById('remote-status').textContent.includes('Encerramento confirmado')`);await logout();
 checkDrafts(await localDrafts(),draftsBefore);assert.deepEqual([...externalOrigins],[]);assert.equal(await evaluate(`localStorage.length+sessionStorage.length`),0);
 const logs=JSON.stringify(securityEvents);assert.ok(!logs.includes('synthetic-ocr-instrument-review'));assert.ok(!logs.includes('raw_excerpt'));assert.ok(!logs.includes('Peso: 72'));
 await fs.mkdir('.test-artifacts',{recursive:true});await fs.writeFile('.test-artifacts/document-ocr-report.json',JSON.stringify({result:'passed',ocr:'real-local',fixtureDirectory,fixtures:evidence,faultInjection:['lost HTTP reply after real commit','one provenance read outage','mocked worker startup error','mocked camera permission denial'],camera:'native Chrome fake-device only',physicalCamera:'not tested',mobile:'390x844 Chrome viewport emulation only',remote:'authorized synthetic development only',imagesUploaded:0,observations:rows.map(r=>r.id),episodeId},null,2)+'\n');
 console.log('PASS: document provenance persists across users, reader/cross-unit writes denied, engine abstains before applicability review and yields synthetic CG only after explicit supplements; desktop Chrome and mobile viewport verified.');
};
