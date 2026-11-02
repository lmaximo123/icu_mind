'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createController}=require('../remote-session.js');
const user={id:'synthetic-user',email:'osler-synthetic-test@example.com'},episode={id:'episode',unit_id:'unit'};
function fixture(t){
 let clock=0,reply,calls=0,started;
 const requested=new Promise(resolve=>{started=resolve;});
 const controller=createController({now:()=>clock,fetchImpl:async(path,init)=>{
  if(path==='/api/auth/login')return Response.json({access_token:'synthetic-session',expires_in:3600,user});
  if(path==='/api/units')return Response.json([{id:'unit'}]);
  if(path.startsWith('/api/encounters?'))return Response.json([episode]);
  if(path.startsWith('/api/observations?'))return Response.json([]);
  if(path==='/api/engine/snapshot'){calls++;assert.equal(init.headers.Authorization,'Bearer synthetic-session');assert.deepEqual(JSON.parse(init.body),{unit_id:'unit',encounter_id:'episode',window_start:'2026-01-01T00:00:00Z',window_end:'2026-01-02T00:00:00Z'});started();return new Promise(resolve=>{reply=body=>resolve(Response.json(body));});}
  throw Error('Unexpected endpoint');
 }});
 t.after(()=>controller.dispose());
 return {controller,requested,respond:body=>reply(body),advance:ms=>{clock+=ms;},calls:()=>calls};
}
const interval={window_start:'2026-01-01T00:00:00Z',window_end:'2026-01-02T00:00:00Z'};
const response={unit_id:'unit',encounter:episode,reviewer_id:user.id,complete:true};
test('snapshot controller requires explicit context and rejects a response for another reviewer without exposing Auth material',async t=>{
 const f=fixture(t);await f.controller.login(user.email,'synthetic');
 await assert.rejects(f.controller.loadEngineSnapshot(interval));assert.equal(f.calls(),0);
 await f.controller.selectUnit('unit');await f.controller.selectEncounter('episode');
 const result=f.controller.loadEngineSnapshot({...interval,unit_id:'forged'});await f.requested;f.respond({...response,reviewer_id:'other'});
 await assert.rejects(result);assert.equal(f.controller.getState().error,true);assert.ok(!JSON.stringify(f.controller.getState()).includes('synthetic-session'));
});
test('snapshot response arriving after absolute session expiry cannot be used',async t=>{
 const f=fixture(t);await f.controller.login(user.email,'synthetic');await f.controller.selectUnit('unit');await f.controller.selectEncounter('episode');
 const result=f.controller.loadEngineSnapshot(interval);await f.requested;f.advance(3601000);f.respond(response);
 await assert.rejects(result);assert.equal(f.controller.getState().expired,true);
});
