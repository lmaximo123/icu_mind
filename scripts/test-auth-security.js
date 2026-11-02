'use strict';
// Real official MFA enrollment is temporary and identified by the returned factor UUID.
// No passwords, OTPs, TOTP secrets, tokens or provider bodies are printed or persisted.
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {generate}=require('otplib');
const {configuration}=require('./test-hosted-writes.js');
const {createStore}=require('../server/supabase.js');
const {assertSignupPolicy}=require('./test-hosted.js');
const fixtures=require('./hosted-fixtures.json');
let stage='configuration';
async function main(){
 const {key,users}=configuration(process.env);
 const store=createStore({url:fixtures.projectUrl,key});
 let token,factor;
 async function auth(path,method='GET',body){
  const response=await fetch(fixtures.projectUrl+'/auth/v1/'+path,{method,redirect:'error',signal:AbortSignal.timeout(15000),
   headers:{apikey:key,...(token?{Authorization:`Bearer ${token}`} :{}),'Content-Type':'application/json'},
   ...(body?{body:JSON.stringify(body)}:{})});
  return response;
 }
 try{
  stage='signup policy';const settings=await auth('settings');assert.equal(settings.status,200);assertSignupPolicy(await settings.json());
  stage='synthetic login and server refresh';
  const session=await store.signIn(users[1].email,users[1].password);token=session.access_token;
  const refreshed=await store.refreshSession(token);token=refreshed.access_token;
  await store.authenticate(token);
  assert.equal(refreshed.refresh_token,undefined);
  console.log('PASS: official login and server-only refresh, no refresh token exposed to the client.');
  stage='temporary synthetic TOTP enrollment';
  const response=await auth('factors','POST',{factor_type:'totp',friendly_name:'osler-disposable-'+randomUUID()});
  assert.equal(response.status,200);
  const enrollment=await response.json();factor=enrollment.id;
  assert.ok(factor && enrollment.totp?.secret);
  const epoch=Math.floor(Date.parse(response.headers.get('date'))/1000);
  assert.ok(Number.isFinite(epoch));
  stage='invalid MFA rejection';
  const challenge=await auth(`factors/${factor}/challenge`,'POST',{});assert.equal(challenge.status,200);
  const challengeId=(await challenge.json()).id;
  // Malformed code is guaranteed invalid, rather than guessing a six-digit OTP.
  const invalid=await auth(`factors/${factor}/verify`,'POST',{challenge_id:challengeId,code:'invalid'});
  assert.ok([400,401,403,422].includes(invalid.status));
  stage='valid MFA verification';
  const code=await generate({secret:enrollment.totp.secret,epoch});
  const elevated=await store.verifyMfa(token,factor,code);token=elevated.access_token;
  // Claims are inspected only after Auth verifies the issued token; never forged.
  await store.authenticate(token);
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  assert.equal(claims.aal,'aal2');
  console.log('PASS: temporary official TOTP enrollment, invalid code denied, valid verification issues AAL2.');
  stage='Storage remains closed';
  const storage=await fetch(fixtures.projectUrl+'/storage/v1/object/osler-no-bucket-'+randomUUID()+'/probe.txt',{
   method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'text/plain'},body:'synthetic probe'});
  assert.ok([400,403,404].includes(storage.status));
  console.log('PASS: direct Storage upload cannot create an object in an unconfigured bucket. No attachment upload is enabled.');
 }finally{
  if(factor){const removal=await auth('factors/'+factor,'DELETE');assert.equal(removal.status,200);factor=null;}
  if(token){await store.signOut(token);await assert.rejects(store.refreshSession(token));}
 }
 console.log('PASS: execution-owned MFA factor removed and session logged out; pre-existing factors were not changed.');
}
main().catch(()=>{console.error(`Auth security test failed at: ${stage}. Credential and provider details suppressed.`);process.exitCode=1;});
