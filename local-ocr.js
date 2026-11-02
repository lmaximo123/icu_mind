/* Shared pinned local worker configuration. No remote OCR or model cache. */
(function(root){'use strict';
function createRunner({tesseract=root.Tesseract}={}){
 let active=null;
 async function recognize(image,onProgress=()=>{}){
  if(active)throw Error('OCR already running');
  let worker,cancelReject;const job={cancelled:false};active=job;
  const abort=()=>Object.assign(new Error('OCR cancelled'),{name:'AbortError'});
  const cancelled=new Promise((_resolve,reject)=>{cancelReject=reject;});
  job.cancel=()=>{job.cancelled=true;cancelReject(abort());if(worker)void worker.terminate().catch(()=>{});};
  const work=(async()=>{
   if(!tesseract?.createWorker)throw Error('OCR unavailable');
   worker=await tesseract.createWorker('por',1,{workerPath:'/vendor/worker.min.js',corePath:'/vendor',langPath:'/vendor',cacheMethod:'none',logger:message=>{
    if(!job.cancelled)onProgress({status:message.status,progress:Number.isFinite(message.progress)?message.progress:null});
   }});
   if(job.cancelled){await worker.terminate();throw abort();}
   const result=await worker.recognize(image);if(job.cancelled)throw abort();
   return {text:result.data.text||'',confidence:Number.isFinite(result.data.confidence)?result.data.confidence:null,version:'tesseract.js/5.1.1 por'};
  })();
  try{return await Promise.race([work,cancelled]);}
  finally {if(worker)try{await worker.terminate();}catch{}if(active===job)active=null;}
 }
 return {recognize,cancel:()=>active?.cancel()};
}
root.OslerLocalOCR={createRunner};
})(globalThis);
