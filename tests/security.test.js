'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const {once}=require('node:events');
const {createServer}=require('../server/app.js');
const {createStore,ApiError}=require('../server/supabase.js');
const {createLimiter,page,checkOrigin}=require('../server/security.js');
test('rate limiter bounds login attempts and expires only its technical window',()=>{
 let now=0; const limit=createLimiter({now:()=>now,loginLimit:2,maxKeys:2});
 const req={url:'/api/auth/login',method:'POST',headers:{},socket:{remoteAddress:'synthetic'}};
 limit(req);limit(req);assert.throws(()=>limit(req),e=>e.status===429);now=600001;limit(req);
});
test('pagination rejects duplicates, unknown query fields, oversized pages and injection',()=>{
 assert.deepEqual(page(new URLSearchParams('limit=20&offset=40')),{limit:20,offset:40});
 for(const value of ['limit=101','offset=-1','limit=1&limit=2','access_token=secret','offset=1;delete','limit=0']) assert.throws(()=>page(new URLSearchParams(value)));
});
test('loopback host allowlist rejects DNS rebinding and spoofed forwarded host',()=>{
 assert.doesNotThrow(()=>checkOrigin({url:'/api/units',headers:{host:'127.0.0.1:3000'}}));
 assert.throws(()=>checkOrigin({url:'/api/units',headers:{host:'evil.example','x-forwarded-host':'127.0.0.1'}}),e=>e.status===403);
 assert.throws(()=>checkOrigin({url:'/',headers:{host:'127.0.0.1.evil.example'}}),e=>e.status===403);
});
test('CSP, origin, rate limit and normalized audit prevent browser exfiltration and log secrets',async t=>{
 const events=[];const server=createServer({authenticate:async()=>({id:'synthetic-actor'}),listUnits:async()=>[]},
 {onSecurityEvent:e=>events.push(e),rateLimits:{readLimit:2}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const base=`http://127.0.0.1:${server.address().port}`;
 const headers={Authorization:'Bearer synthetic.secret'};
 let response=await fetch(base+'/api/units',{headers});
 assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
 assert.doesNotMatch(response.headers.get('content-security-policy'),/unsafe-inline/);
 assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 response=await fetch(base+'/api/units',{headers:{...headers,Origin:'https://evil.example'}});assert.equal(response.status,403);
 response=await fetch(base+'/api/units?access_token=never-log-this',{headers});assert.equal(response.status,400);
 response=await fetch(base+'/api/units',{headers});assert.equal(response.status,429);
 assert.ok(response.headers.get('retry-after'));
 await new Promise(r=>setImmediate(r));
 assert.ok(events.some(e=>e.status===429));
 assert.doesNotMatch(JSON.stringify(events),/secret|never-log-this|evil\.example/);
});
test('server-only refresh vault rotates material, coalesces concurrent refresh and rejects after logout',async()=>{
 const email='osler-synthetic-reader@example.com';let refreshCalls=0;
 const session=(token,refresh)=>({access_token:token,refresh_token:refresh,expires_in:3600,user:{id:'synthetic',email}});
 const store=createStore({url:'https://otnwkxchugsovtjdanyu.supabase.co',key:'sb_publishable_synthetic',fetchImpl:async(url,options)=>{
  if(url.pathname.endsWith('/logout'))return new Response(null,{status:204});
  if(url.search.includes('refresh_token')){refreshCalls++;assert.deepEqual(JSON.parse(options.body),{refresh_token:'private-refresh'});await new Promise(r=>setTimeout(r,5));return Response.json(session('synthetic.new','private-rotated'));}
  return Response.json(session('synthetic.old','private-refresh'));
 }});
 const signed=await store.signIn(email,'synthetic-password');assert.equal(signed.refresh_token,undefined);
 const [a,b]=await Promise.all([store.refreshSession(signed.access_token),store.refreshSession(signed.access_token)]);
 assert.deepEqual(a,b);assert.equal(refreshCalls,1);assert.equal(a.refresh_token,undefined);
 await assert.rejects(store.refreshSession(signed.access_token),e=>e.status===401);
 await store.signOut(a.access_token);await assert.rejects(store.refreshSession(a.access_token),e=>e.status===401);
});
test('server refresh absolute lifetime cannot be extended indefinitely',async()=>{
 let clock=0;
 const store=createStore({url:'https://otnwkxchugsovtjdanyu.supabase.co',key:'sb_publishable_synthetic',now:()=>clock,sessionLifetimeMs:1000,
 fetchImpl:async()=>Response.json({access_token:'synthetic',refresh_token:'private',expires_in:3600,user:{id:'test',email:'osler-synthetic-reader@example.com'}})});
 const session=await store.signIn('osler-synthetic-reader@example.com','synthetic');clock=1001;
 await assert.rejects(store.refreshSession(session.access_token),e=>e.status===401);
});
test('logout racing an in-flight refresh cannot resurrect a revoked session in the vault',async()=>{
 let resolveRefresh,started;
 const barrier=new Promise(resolve=>{started=resolve;});
 const email='osler-synthetic-reader@example.com';
 const session=token=>({access_token:token,refresh_token:'private-refresh',expires_in:3600,user:{id:'synthetic',email}});
 const store=createStore({url:'https://otnwkxchugsovtjdanyu.supabase.co',key:'sb_publishable_synthetic',fetchImpl:async url=>{
  if(url.pathname.endsWith('/logout'))return new Response(null,{status:204});
  if(url.search.includes('refresh_token')){started();return new Promise(resolve=>{resolveRefresh=()=>resolve(Response.json(session('new.synthetic')));});}
  return Response.json(session('old.synthetic'));
 }});
 const signed=await store.signIn(email,'synthetic');const pending=store.refreshSession(signed.access_token);
 await barrier;await store.signOut(signed.access_token);resolveRefresh();
 await assert.rejects(pending,e=>e.status===401);
 await assert.rejects(store.refreshSession('new.synthetic'),e=>e.status===401);
});
test('correction endpoint rejects author injection and forwards an append-only reason-code request',async t=>{
 const uuid='60000000-0000-0000-0000-000000000001';const calls=[];
 const server=createServer({authenticate:async()=>({id:uuid}),correctObservation:async(_,body)=>{calls.push(body);return {id:body.replacement_event};}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const body={id:uuid,original_event_id:'60000000-0000-0000-0000-000000000002',value:7.35,unit:'',timestamp:new Date().toISOString(),reason_code:'transcription'};
 const call=payload=>fetch(`http://127.0.0.1:${server.address().port}/api/observations/correct`,{method:'POST',headers:{Authorization:'Bearer synthetic','Content-Type':'application/json'},body:JSON.stringify(payload)});
 assert.equal((await call({...body,recorded_by:uuid})).status,400);
 assert.equal((await call({...body,reason_code:'free clinical text'})).status,422);
 assert.equal((await call(body)).status,200);assert.equal(calls.length,1);
 assert.equal(calls[0].original_event,body.original_event_id);assert.equal(calls[0].reason,'transcription');
 assert.equal(calls[0].recorded_by,undefined);
});
