'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createController}=require('../remote-session.js');
const {row}=require('./fixtures/document-fixture.js');
async function fixture(t){
 const user={id:randomUUID(),email:'osler-synthetic-doc@example.com'},unit=randomUUID(),episode=randomUUID(),saved=new Map(),attempts=[];let lose=true,other=false;
 const controller=createController({fetchImpl:async(path,init)=>{
  if(path==='/api/auth/login')return Response.json({access_token:'synthetic-document-session',expires_in:3600,user:{...user,id:other?'other-user':user.id}});
  if(path==='/api/auth/logout')return Response.json({signed_out:true});
  if(path==='/api/units')return Response.json([{id:unit}]);if(path.startsWith('/api/encounters?'))return Response.json([{id:episode,unit_id:unit,ended_at:null}]);
  if(path.startsWith('/api/observations?'))return Response.json([...saved.values()].map(r=>r.event));
  if(path.startsWith('/api/document-observations?'))return Response.json([...saved.entries()].map(([id,r])=>({observation_id:id,metadata:r.source,event:r.event})));
  if(path==='/api/document-observations'){
   const request=JSON.parse(init.body);attempts.push(request);const event={id:request.id,encounter_id:episode,recorded_by:user.id,concept:request.concept,numeric_value:request.value,unit:request.unit,source_type:'document',measured_at:request.timestamp};
   if(!saved.has(request.id))saved.set(request.id,{event,source:request.source});
   if(saved.size===2&&lose){lose=false;return Response.json({error:'unavailable'},{status:503});}return Response.json(saved.get(request.id));
  }throw Error('Unexpected test endpoint');
 }});
 t.after(()=>controller.dispose());await controller.login(user.email,'synthetic');await controller.selectUnit(unit);await controller.selectEncounter(episode);
 const documentId=randomUUID(),rows=Array.from({length:3},(_,i)=>{const request=row();request.unit_id=unit;request.encounter_id=episode;request.source.document_id=documentId;request.source.candidate_key=`line:${i}:item:${i}`;return request;});
 return {controller,rows,saved,attempts,other:()=>{other=true;}};
}
test('mocked partial/lost responses retain fixed IDs, verify confirmed rows without resending and retry remaining without duplication',async t=>{
 const f=await fixture(t);await assert.rejects(f.controller.sendDocumentBatch(f.rows));
 assert.deepEqual(f.controller.getState().documentBatch.rows.map(r=>r.status),['confirmed','uncertain','unsubmitted']);assert.equal(f.saved.size,2);
 await assert.rejects(f.controller.selectUnit('other'));assert.throws(()=>f.controller.discardDocumentBatch());
 await f.controller.verifyDocumentBatch();assert.deepEqual(f.controller.getState().documentBatch.rows.map(r=>r.status),['confirmed','confirmed','unsubmitted']);assert.equal(f.attempts.length,2);
 await f.controller.retryDocumentBatch();assert.equal(f.saved.size,3);assert.equal(f.attempts.length,3);assert.deepEqual(f.attempts.map(r=>r.id),f.rows.map(r=>r.id));
 assert.ok(f.controller.getState().documentBatch.rows.every(r=>r.status==='confirmed'));
});
test('mocked lost reply retries identical body; pending batch survives logout and rejects a different user',async t=>{
 const f=await fixture(t);await assert.rejects(f.controller.sendDocumentBatch(f.rows));const previous=f.attempts[1];
 await f.controller.logout();assert.ok(f.controller.getState().documentBatch);f.other();await assert.rejects(f.controller.login('osler-synthetic-other@example.com','synthetic'));
 assert.equal(f.saved.size,2);assert.deepEqual(f.controller.getState().documentBatch.rows[1].request,previous);
});
test('mocked pending batch resumes for same user after logout without auto-selecting a new destination or changing IDs',async t=>{
 const f=await fixture(t);await assert.rejects(f.controller.sendDocumentBatch(f.rows));const previous=f.attempts[1];await f.controller.logout();
 await f.controller.login('osler-synthetic-doc@example.com','synthetic');assert.equal(f.controller.getState().unitId,'');
 await f.controller.retryDocumentBatch();assert.equal(f.saved.size,3);assert.deepEqual(f.attempts[2],previous);assert.equal(f.controller.getState().encounterId,'');
});
