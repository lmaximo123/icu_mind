'use strict';
// Run only after administrative schema inspection and execution-owned fixture setup.
// Secrets, OTPs, provider bodies and clinical values are never printed.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const {once}=require('node:events');
const {generate}=require('otplib');
const {configuration,observationTimestamp}=require('./test-hosted-writes.js');
const {assertSignupPolicy}=require('./test-hosted.js');
const {createStore}=require('../server/supabase.js');
const {createServer}=require('../server/app.js');
let stage='configuration';
async function main(){
 const {key,users}=configuration(process.env);
 const fixture=JSON.parse(fs.readFileSync('.test-artifacts/protected-fixtures.json','utf8'));
 assert.equal(fixture.projectUrl,process.env.SUPABASE_URL);
 for(const id of [fixture.unitP,fixture.unitQ,fixture.runId])assert.match(id,/^[0-9a-f-]{36}$/i);
 const store=createStore({url:fixture.projectUrl,key});
 const sessions=[],episodes=[];
 const server=createServer(store,{enableRemoteUI:true});
 let base;
 async function auth(user,path,method='GET',body){
  return fetch(fixture.projectUrl+'/auth/v1/'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),
   headers:{apikey:key,...(user?.token?{Authorization:`Bearer ${user.token}`} :{}),'Content-Type':'application/json'},
   ...(body?{body:JSON.stringify(body)}:{})});
 }
 async function rest(user,path,method='GET',body,profile){
  const response=await fetch(fixture.projectUrl+'/rest/v1/'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),
   headers:{apikey:key,...(user?.token?{Authorization:`Bearer ${user.token}`} :{}),'Content-Type':'application/json',Prefer:'return=representation',
    ...(profile?{'Accept-Profile':profile,'Content-Profile':profile}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
 }
 async function api(user,path,method='GET',body){
  const response=await fetch(base+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),
   headers:{Authorization:`Bearer ${user.token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
 }
 async function elevate(user){
  const response=await auth(user,'factors','POST',{factor_type:'totp',friendly_name:'osler-protected-'+fixture.runId});
  assert.equal(response.status,200);const enrolled=await response.json();
  user.factor=enrolled.id;user.secret=enrolled.totp.secret;
  const epoch=Math.floor(Date.parse(response.headers.get('date'))/1000);
  const challenge=await auth(user,`factors/${user.factor}/challenge`,'POST',{});assert.equal(challenge.status,200);
  const invalid=await auth(user,`factors/${user.factor}/verify`,'POST',{challenge_id:(await challenge.json()).id,code:'invalid'});
  assert.ok([400,401,403,422].includes(invalid.status));
  const session=await store.verifyMfa(user.token,user.factor,await generate({secret:user.secret,epoch}));
  user.token=session.access_token;await store.authenticate(user.token);
  assert.equal(JSON.parse(Buffer.from(user.token.split('.')[1],'base64url').toString()).aal,'aal2');
 }
 async function create(user,unit){
  const id=randomUUID();episodes.push({user,id});
  const response=await api(user,'/api/encounters','POST',{id,unit_id:unit,bed_code:'001'});
  assert.equal(response.status,200);assert.equal(response.body[0].id,id);return response.body[0];
 }
 try{
  stage='signup and schema preflight';
  const settings=await auth(null,'settings');assert.equal(settings.status,200);assertSignupPolicy(await settings.json());
  assert.equal((await rest(null,'rpc/audit_unit','POST',{target_unit:fixture.unitP})).status,401);
  server.listen(0,'127.0.0.1');await once(server,'listening');base=`http://127.0.0.1:${server.address().port}`;
  for(const user of users){
   const session=await store.signIn(user.email,user.password);user.token=session.access_token;user.id=session.user.id;sessions.push(user);
   const info=await auth(user,'user');assert.equal(info.status,200);
   user.existingFactors=((await info.json()).factors || []).map(f=>f.id).sort();
  }
  const [reader,clinician,admin]=users;
  const initialTokens=users.map(user=>user.token);
  stage='AAL1 denied by database, regardless of role';
  for(const user of users){
   const permission=await rest(user,'rpc/can_access_unit','POST',{target_unit:fixture.unitP,write_access:false});
   assert.equal(permission.status,200);assert.equal(permission.body,false);
   const read=await rest(user,`units?id=eq.${fixture.unitP}&select=id`);assert.equal(read.status,200);assert.deepEqual(read.body,[]);
   const write=await api(user,'/api/encounters','POST',{id:randomUUID(),unit_id:fixture.unitP,bed_code:'002'});assert.equal(write.status,403);
   assert.equal((await rest(user,'rpc/audit_unit','POST',{target_unit:fixture.unitP})).status,403);
  }
  console.log('PASS: real AAL1 reader/clinician/admin cannot read, create or audit the MFA-protected unit.');
  stage='real TOTP step-up for three roles';
  for(const user of users)await elevate(user);
  for(const user of users){const read=await rest(user,`units?id=eq.${fixture.unitP}&select=id`);assert.equal(read.status,200);assert.equal(read.body.length,1);}
  console.log('PASS: invalid MFA codes rejected; all three official AAL2 sessions access their authorized protected unit.');
  stage='protected writes and correction provenance';
  const epP=await create(clinician,fixture.unitP),epQ=await create(admin,fixture.unitQ);
  const snapshotArgs={target_unit:fixture.unitP,target_episode:epP.id,window_start:epP.started_at,window_end:new Date(Math.ceil(Date.parse(epP.started_at)/1000)*1000).toISOString()};
  while(Date.now()<Date.parse(snapshotArgs.window_end)+50)await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal((await rest(null,'rpc/engine_snapshot','POST',snapshotArgs)).status,401);
  for(const token of initialTokens)assert.equal((await rest({token},'rpc/engine_snapshot','POST',snapshotArgs)).status,403);
  const event={id:randomUUID(),encounter_id:epP.id,concept:'ph',value:7.4,unit:'',timestamp:observationTimestamp(epP.started_at),confirmed:true,source_type:'manual'};
  const saved=await api(clinician,'/api/observations','POST',event);assert.equal(saved.status,200);assert.equal(saved.body.recorded_by,clinician.id);
  const eventQ={...event,id:randomUUID(),encounter_id:epQ.id,timestamp:observationTimestamp(epQ.started_at)};
  assert.equal((await api(admin,'/api/observations','POST',eventQ)).status,200);
  const correction={original_event_id:event.id,id:randomUUID(),value:7.35,unit:'',timestamp:event.timestamp,reason_code:'transcription'};
  const fixed=await api(clinician,'/api/observations/correct','POST',correction);assert.equal(fixed.status,200);
  assert.equal(fixed.body.id,correction.id);assert.equal(fixed.body.recorded_by,clinician.id);
  const retry=await api(clinician,'/api/observations/correct','POST',correction);assert.equal(retry.status,200);assert.deepEqual(retry.body,fixed.body);
  assert.equal((await api(clinician,'/api/observations/correct','POST',{...correction,reason_code:'other'})).status,409);
  const originals=await rest(clinician,`observation_events?id=eq.${event.id}&select=*`);assert.deepEqual(originals.body,[saved.body]);
  const link=await rest(reader,`observation_corrections?replacement_event_id=eq.${correction.id}&select=*`);
  assert.equal(link.status,200);assert.equal(link.body.length,1);assert.equal(link.body[0].original_event_id,event.id);assert.equal(link.body[0].recorded_by,clinician.id);
  assert.equal((await api(reader,'/api/observations/correct','POST',{...correction,id:randomUUID()})).status,403);
  assert.equal((await api(clinician,'/api/observations/correct','POST',{...correction,id:randomUUID(),original_event_id:eventQ.id})).status,403);
  assert.equal((await rest(reader,'observation_corrections','POST',link.body[0])).status,403);
  assert.equal((await rest(clinician,`observation_corrections?replacement_event_id=eq.${correction.id}`,'PATCH',{reason_code:'other'})).status,403);
  snapshotArgs.window_end=new Date(Math.max(Date.now()-1000,Date.parse(event.timestamp))).toISOString();
  while(Date.now()<Date.parse(snapshotArgs.window_end)+50)await new Promise(resolve=>setTimeout(resolve,50));
  for(const user of users){
   const snap=await rest(user,'rpc/engine_snapshot','POST',snapshotArgs);assert.equal(snap.status,200);assert.equal(snap.body.complete,true);
   assert.equal(snap.body.event_count,2);assert.equal(snap.body.correction_count,1);assert.equal(snap.body.reviewer_id,user.id);
   assert.ok(snap.body.corrections.some(c=>c.replacement_event_id===correction.id));
  }
  assert.equal((await rest(clinician,'rpc/engine_snapshot','POST',{...snapshotArgs,target_unit:fixture.unitQ,target_episode:epQ.id})).status,403);
  assert.equal((await rest(clinician,'rpc/engine_snapshot','POST',{...snapshotArgs,target_unit:fixture.unitQ})).status,403);
  console.log('PASS: snapshot RPC denies anonymous/AAL1/cross-context callers; authorized AAL2 reader/clinician/admin see the same complete events and corrections under RLS.');
  stage='document provenance under protected MFA roles';
  const doc=require('../tests/fixtures/document-fixture.js').row();doc.unit_id=fixture.unitP;doc.encounter_id=epP.id;doc.timestamp=observationTimestamp(epP.started_at);
  while(Date.now()<Date.parse(doc.timestamp)+10)await new Promise(resolve=>setTimeout(resolve,50));doc.source.reviewed_at=new Date().toISOString();
  const docArgs={event_id:doc.id,target_unit:fixture.unitP,target_encounter:epP.id,observation_concept:doc.concept,observation_value:doc.value,observation_unit:doc.unit,observation_time:doc.timestamp,source:doc.source};
  assert.equal((await rest(null,'rpc/append_document_observation','POST',docArgs)).status,401);
  for(const token of initialTokens)assert.equal((await rest({token},'rpc/append_document_observation','POST',docArgs)).status,403);
  assert.equal((await api(reader,'/api/document-observations','POST',doc)).status,403);
  assert.equal((await api(clinician,'/api/document-observations','POST',{...doc,unit_id:fixture.unitQ})).status,403);
  const savedDoc=await api(clinician,'/api/document-observations','POST',doc);assert.equal(savedDoc.status,200);assert.equal(savedDoc.body.event.id,doc.id);
  assert.equal((await api(clinician,'/api/document-observations','POST',doc)).status,200);
  const visibleDoc=await rest(reader,`document_observation_sources?observation_id=eq.${doc.id}&select=*`);assert.equal(visibleDoc.status,200);assert.equal(visibleDoc.body.length,1);
  assert.equal((await rest(reader,'document_observation_sources','POST',visibleDoc.body[0])).status,403);
  assert.equal((await rest(clinician,`document_observation_sources?observation_id=eq.${doc.id}`,'PATCH',{metadata:{}})).status,403);
  assert.equal((await rest(clinician,`document_observation_sources?observation_id=eq.${doc.id}`,'DELETE')).status,403);
  console.log('PASS: document scalar provenance RPC requires authorized MFA/role, rejects anonymous/AAL1/reader/cross-unit writes and direct metadata mutation; exact retry preserves one event/source. Metadata fixture here is synthetic, OCR verified separately in Chrome.');
  console.log('PASS: append-only correction preserves the original, binds author/reason and link, retries identically and rejects reader/cross-unit/direct mutation.');
  stage='audit isolation, metadata minimization and no access escalation';
  for(const user of [reader,clinician])assert.equal((await rest(user,'rpc/audit_unit','POST',{target_unit:fixture.unitP})).status,403);
  const audit=await rest(admin,'rpc/audit_unit','POST',{target_unit:fixture.unitP,row_limit:100});assert.equal(audit.status,200);
  assert.ok(audit.body.some(row=>row.entity==='observation_corrections' && row.entity_id===correction.id && row.actor_id===clinician.id));
  assert.ok(audit.body.some(row=>row.entity==='observation_events' && row.entity_id===event.id));
  for(const row of audit.body)assert.deepEqual(Object.keys(row).sort(),['actor_id','entity','entity_id','occurred_at','operation']);
  assert.equal((await rest(admin,'rpc/audit_unit','POST',{target_unit:fixture.unitQ})).status,403);
  assert.equal((await rest(admin,'rpc/audit_unit','POST',{target_unit:fixture.unitP,row_limit:null})).status,403);
  assert.equal((await rest(admin,'audit_events?select=*','GET',null,'osler_private')).status,406);
  assert.equal((await rest(admin,'unit_members','POST',{unit_id:fixture.unitP,user_id:reader.id,role:'admin'})).status,403);
  const readerWrite=await api(reader,'/api/observations','POST',{...event,id:randomUUID()});assert.equal(readerWrite.status,403);
  const closeDenied=await api(reader,`/api/encounters/${epP.id}/close`,'POST',{});assert.equal(closeDenied.status,200);assert.deepEqual(closeDenied.body,[]);
  const cross=await rest(clinician,`observation_events?encounter_id=eq.${epQ.id}&select=id`);assert.equal(cross.status,200);assert.deepEqual(cross.body,[]);
  console.log('PASS: only AAL2 admin audits its admin unit; audit contains metadata only; private schema and membership escalation remain blocked.');
  stage='closure and correction retry after closure';
  const closed=await api(clinician,`/api/encounters/${epP.id}/close`,'POST',{});assert.equal(closed.status,200);assert.equal(closed.body.length,1);
  assert.equal((await api(clinician,'/api/observations/correct','POST',{...correction,id:randomUUID()})).status,422);
  const afterClose=await api(clinician,'/api/observations/correct','POST',correction);assert.equal(afterClose.status,200);assert.deepEqual(afterClose.body,fixed.body);
  assert.equal((await api(clinician,'/api/document-observations','POST',doc)).status,200);
  assert.equal((await api(clinician,'/api/document-observations','POST',{...doc,id:randomUUID()})).status,422);
  await store.closeEncounter(admin.token,epQ.id);
  stage='session revocation enforced by database for an issued AAL2 JWT';
  const removal=await auth(reader,'factors/'+reader.factor,'DELETE');assert.equal(removal.status,200);reader.factor=null;
  const old=reader.token;await store.signOut(old);reader.loggedOut=true;
  const permission=await rest(reader,'rpc/can_access_unit','POST',{target_unit:fixture.unitP});assert.equal(permission.status,200);assert.equal(permission.body,false);
  const hidden=await rest(reader,`observation_events?encounter_id=eq.${epP.id}&select=id`);assert.equal(hidden.status,200);assert.deepEqual(hidden.body,[]);
  assert.equal((await rest(reader,'rpc/correct_observation','POST',{original_event:event.id,replacement_event:randomUUID(),replacement_value:7.3,replacement_unit:'',replacement_time:event.timestamp,reason:'other'})).status,403);
  console.log('PASS: closed episodes reject new corrections but accept exact retries; logout removes protected access even for the previously issued AAL2 JWT.');
  fs.writeFileSync('.test-artifacts/protected-result.json',JSON.stringify({runId:fixture.runId,project:fixture.projectUrl,result:'passed',episodes:episodes.map(row=>row.id),original:event.id,replacement:correction.id},null,2)+'\n');
 }finally{
  const errors=[];
  for(const row of episodes)try{await store.closeEncounter(row.user.token,row.id);}catch{errors.push('episode closure');}
  for(const user of sessions){
   try{
    if(user.factor){const removal=await auth(user,'factors/'+user.factor,'DELETE');assert.equal(removal.status,200);user.factor=null;}
    if(!user.loggedOut){
     const info=await auth(user,'user');assert.equal(info.status,200);assert.deepEqual(((await info.json()).factors||[]).map(f=>f.id).sort(),user.existingFactors);
     await store.signOut(user.token);
    }
   }catch{errors.push('factor/session cleanup');}
   user.token=undefined;user.secret=undefined;user.password=undefined;
  }
  await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});
  if(errors.length)throw new Error('Execution-owned resource cleanup failed');
 }
 console.log('Hosted protected MFA/audit/correction suite passed; new episodes closed, execution-owned factors removed and sessions logged out.');
}
main().catch(()=>{console.error(`Protected security suite failed at: ${stage}. Credentials, codes and provider details suppressed.`);process.exitCode=1;});
