/* Image review stays in memory; only explicitly reviewed scalar fields leave this view. */
(function(root){'use strict';
function create({sendBatch,retryBatch,verifyBatch,pauseBatch,discardBatch,loadSources}){
 const $=id=>document.getElementById(id),runner=OslerLocalOCR.createRunner();
 let state,contextKey='',account='',original,originalUrl,originalHash,documentId,capturedAt=null,rotation=0,crop,
  ocrImage=null,ocrHash=null,candidates=[],generation=0,busy=false,stream=null,cameraGeneration=0,drag=null,lastComplete='',cropPending=false;
 const canvas=$('doc-canvas'),ctx=canvas.getContext('2d');
 const pending=()=>state?.documentBatch?.rows.some(row=>row.status!=='confirmed');
 const allowed=()=>state?.user&&!state.expired&&!state.busy&&!pending()&&!state.pending&&!state.pendingEncounter;
 const status=text=>{$('doc-status').textContent=text;};
 const asISO=id=>$(id).value?new Date($(id).value).toISOString():null;
 const hash=async blob=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
 function controls(){
  for(const id of ['doc-file','doc-demo','doc-camera','doc-rotate','doc-crop','doc-reset','doc-ocr'])$(id).disabled=busy||!allowed()||(['doc-rotate','doc-crop','doc-reset','doc-ocr'].includes(id)&&!original);
  for(const input of $('doc-candidates').querySelectorAll('input'))input.disabled=busy||!allowed();
  for(const id of ['doc-photo-at','doc-document-at','doc-send-confirm'])$(id).disabled=busy||!allowed();
  for(const key of ['x','y','width','height'])$('doc-crop-'+key).disabled=busy||!allowed()||!original;
  if(cropPending)$('doc-ocr').disabled=true;
  $('doc-send').disabled=busy||!allowed()||!state.unitId||!state.encounterId||!!state.encounters.find(e=>e.id===state.encounterId)?.ended_at||!ocrImage||!candidates.length;
 }
 function invalidate(clearOCR=false){
  generation++;runner.cancel();$('doc-send-confirm').checked=false;
  $('doc-retry-confirm').checked=false;
  for(const box of $('doc-candidates').querySelectorAll('input[type=checkbox]'))box.checked=false;
  if(clearOCR){ocrImage=null;ocrHash=null;candidates=[];$('doc-text').value='';$('doc-candidates').replaceChildren();$('doc-confidence').textContent='Confiança OCR indisponível; não é confiança clínica.';}
  controls();
 }
 function stopCamera(){cameraGeneration++;stream?.getTracks().forEach(track=>track.stop());stream=null;$('doc-video').srcObject=null;$('doc-video').hidden=true;$('doc-capture').hidden=true;$('doc-stop-camera').hidden=true;}
 function clearImage(){
  invalidate(true);original?.close();original=null;if(originalUrl)URL.revokeObjectURL(originalUrl);originalUrl=null;
  originalHash=null;documentId=null;capturedAt=null;rotation=0;crop=null;cropPending=false;canvas.width=1;canvas.height=1;canvas.hidden=true;
  $('doc-original').removeAttribute('src');$('doc-original').hidden=true;$('doc-file').value='';
  $('doc-photo-at').value='';$('doc-document-at').value='';$('doc-captured-at').textContent='Instante de captura no navegador: não disponível para arquivo; EXIF não interpretado.';controls();
 }
 function rotated(){
  const image=document.createElement('canvas');image.width=rotation%180?original.height:original.width;image.height=rotation%180?original.width:original.height;
  const c=image.getContext('2d');c.translate(image.width/2,image.height/2);c.rotate(rotation*Math.PI/180);c.drawImage(original,-original.width/2,-original.height/2);return image;
 }
 function draw(){
  if(!original)return;const image=rotated();if(!crop)crop={x:0,y:0,width:image.width,height:image.height};
  canvas.width=crop.width;canvas.height=crop.height;ctx.drawImage(image,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height);canvas.hidden=false;
  for(const key of ['x','y','width','height'])$('doc-crop-'+key).value=crop[key];
 }
 async function load(file,capture=null){
  if(!allowed())throw Error('Resolve pending work');stopCamera();clearImage();const current=generation;
  if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type)||!file.size||file.size>10*1024*1024)throw Error('Invalid image file');
  busy=true;controls();status('Abrindo imagem local…');
  try{
   const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
   const signature=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;
   if(signature!==file.type)throw Error('Invalid image signature');
   const bitmap=await createImageBitmap(file);
   if(current!==generation){bitmap.close();return;}
   if(bitmap.width>8000||bitmap.height>8000||bitmap.width*bitmap.height>16000000){bitmap.close();throw Error('Image too large');}
   const digest=await hash(file);if(current!==generation){bitmap.close();return;}
   original=bitmap;originalHash=digest;documentId=crypto.randomUUID();capturedAt=capture;
   originalUrl=URL.createObjectURL(file);$('doc-original').src=originalUrl;$('doc-original').hidden=false;
   if(capture)$('doc-captured-at').textContent='Quadro capturado no navegador em '+capture+'; não implica horário da medição.';
   draw();status('Imagem aberta. Ajuste rotação/recorte e execute OCR local; horários continuam pendentes.');
  }finally{busy=false;controls();}
 }
 function makeCandidates(text){
  candidates=OslerDocumentReview.candidates(text);$('doc-candidates').replaceChildren();
  candidates.forEach((candidate,index)=>{
   const box=document.createElement('fieldset');box.className='border rounded-lg p-2';box.dataset.index=index;
   box.dataset.concept=candidate.concept;
   const labels={weight:'Peso',creatinine:'Creatinina',ph:'pH',sbp:'Pressão sistólica',map:'PAM',heartRate:'Frequência cardíaca',respiratoryRate:'Frequência respiratória',spo2:'SpO₂'};
   const legend=document.createElement('legend');legend.textContent=(labels[candidate.concept]||candidate.concept)+' · linha '+candidate.line;box.append(legend);
   const source=document.createElement('p');source.textContent='Origem OCR (não confirmada): '+candidate.excerpt;box.append(source);
   for(const [field,type,value,labelText] of [['value','text',candidate.rawValue,'Valor revisado'],['unit','text',candidate.rawUnit||'','Unidade revisada (ausente = pendente, exceto grandeza sem unidade)'],['time','datetime-local','','Horário desta medição (obrigatório)'],['reason','text','','Justificativa de correção de valor/unidade, quando necessária']]){
    const label=document.createElement('label');label.textContent=labelText+' ';const input=document.createElement('input');input.type=type;input.value=value;input.dataset.field=field;input.id=`doc-field-${index}-${field}`;
    if(type==='datetime-local')input.step='1';if(field==='reason')input.maxLength=240;label.append(input);box.append(label,document.createElement('br'));
   }
   const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.dataset.field='reviewed';check.id=`doc-field-${index}-reviewed`;
   label.append(check,document.createTextNode('Revisei esta medição, unidade, trecho fonte, horário e destino; incluir no envio'));box.append(label);$('doc-candidates').append(box);
  });
 }
 function render(next){
  state=next;const nextAccount=state.user?.id||'',nextKey=JSON.stringify([nextAccount,state.expired,state.unitId,state.encounterId]);
  if(nextKey!==contextKey){contextKey=nextKey;invalidate();stopCamera();
   $('doc-receipt-list').textContent='';
   for(const input of $('doc-candidates').querySelectorAll('[data-field=time]'))input.value='';
   if(nextAccount!==account||state.expired){clearImage();account=nextAccount;status('Sessão/contexto alterado. Nenhuma imagem retida; revise novamente.');}
   else status('Unidade/episódio alterado: revisão e horários de medição invalidados. Confira o novo destino.');
  }
  const batch=state.documentBatch;$('doc-batch').replaceChildren();
  if(batch){
   const header=document.createElement('p');header.textContent=`Lote ${batch.documentId} · unidade ${batch.unitId} · episódio ${batch.encounterId} · usuário ${batch.userId}`;$('doc-batch').append(header);
   for(const row of batch.rows){const item=document.createElement('p');item.textContent=`${row.status} · ID ${row.request.id} · ${row.request.concept}: ${row.request.value} ${row.request.unit} · medição ${row.request.timestamp}`;$('doc-batch').append(item);}
   for(const row of batch.omitted||[]){const item=document.createElement('p');item.textContent=`Encerrado sem confirmação: ${row.status} · ID ${row.id}`;$('doc-batch').append(item);}
   if(!pending()&&batch.documentId!==lastComplete){lastComplete=batch.documentId;clearImage();status(batch.omitted?.length?`Lote encerrado: ${batch.rows.length} confirmados, ${batch.omitted.length} não confirmados. Registros preservados; imagem descartada.`:'Lote confirmado. Imagem e texto descartados; consulte os comprovantes e prepare a prévia abaixo.');}
  }
  $('doc-verify').disabled=state.busy||!state.user||!pending();$('doc-retry').disabled=$('doc-verify').disabled;
  $('doc-pause').disabled=!state.busy||!pending();$('doc-discard-batch').disabled=state.busy||!batch||batch.rows.some(row=>row.status==='uncertain');
  controls();
 }
 $('doc-file').addEventListener('change',()=>{void load($('doc-file').files[0]).catch(()=>status('Não foi possível abrir: use PNG/JPEG/WebP válido até 10 MB, 8000 pixels por lado e 16 MP.'));});
 for(const type of OslerSyntheticImages.types)$('doc-demo-type').append(new Option(type,type));
 $('doc-demo').addEventListener('click',()=>{void OslerSyntheticImages.create($('doc-demo-type').value).then(({blob})=>load(blob)).catch(()=>status('Exemplo indisponível ou trabalho pendente.'));});
 $('doc-download').addEventListener('click',()=>{void OslerSyntheticImages.create($('doc-demo-type').value).then(({blob})=>{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='osler-synthetic-'+$('doc-demo-type').value+'.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});});
 $('doc-rotate').addEventListener('click',()=>{if(!original||busy||!allowed())return;invalidate(true);rotation=(rotation+90)%360;crop=null;cropPending=false;draw();controls();status('Rotação aplicada; execute novo OCR e revisão.');});
 $('doc-reset').addEventListener('click',()=>{if(!original||busy||!allowed())return;invalidate(true);rotation=0;crop=null;cropPending=false;draw();controls();status('Original restaurado; execute novo OCR e revisão.');});
 $('doc-crop').addEventListener('click',()=>{
  if(!original||busy||!allowed())return;
  const proposed=Object.fromEntries(['x','y','width','height'].map(k=>[k,Number($('doc-crop-'+k).value)])),image=rotated();
  if(Object.values(proposed).some(v=>!Number.isInteger(v))||proposed.x<0||proposed.y<0||proposed.width<1||proposed.height<1||proposed.x+proposed.width>image.width||proposed.y+proposed.height>image.height){status('Recorte inválido: confira os limites em pixels da imagem girada.');return;}
  invalidate(true);crop=proposed;cropPending=false;draw();controls();status('Recorte aplicado; execute novo OCR e revisão.');
 });
 for(const key of ['x','y','width','height'])$('doc-crop-'+key).addEventListener('input',()=>{if(original&&!busy){cropPending=true;invalidate(true);status('Recorte alterado: aplique ou restaure antes do OCR.');}});
 const point=event=>{const bounds=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,Math.round((event.clientX-bounds.left)*canvas.width/bounds.width))),y:Math.max(0,Math.min(canvas.height,Math.round((event.clientY-bounds.top)*canvas.height/bounds.height)))};};
 canvas.addEventListener('pointerdown',event=>{if(busy||!allowed())return;drag=point(event);canvas.setPointerCapture(event.pointerId);});
 canvas.addEventListener('pointermove',event=>{if(!drag||!original)return;const end=point(event);draw();ctx.strokeStyle='#e11d48';ctx.lineWidth=Math.max(2,canvas.width/400);ctx.strokeRect(Math.min(drag.x,end.x),Math.min(drag.y,end.y),Math.abs(end.x-drag.x),Math.abs(end.y-drag.y));});
 canvas.addEventListener('pointercancel',()=>{drag=null;if(original)draw();});
 canvas.addEventListener('pointerup',event=>{if(!drag||!crop)return;const end=point(event),start=drag;drag=null;
  if(end.x===start.x||end.y===start.y)return;const proposed={x:crop.x+Math.min(start.x,end.x),y:crop.y+Math.min(start.y,end.y),width:Math.abs(end.x-start.x),height:Math.abs(end.y-start.y)};
  for(const key of Object.keys(proposed))$('doc-crop-'+key).value=proposed[key];cropPending=true;invalidate(true);status('Área selecionada. Clique em Aplicar recorte.');
 });
 $('doc-ocr').addEventListener('click',async()=>{
  if(!original||busy||!allowed()||cropPending)return;invalidate(true);draw();const current=generation;busy=true;controls();$('doc-progress').value=0;
  try{
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('No pixels');
   const digest=await hash(blob);if(current!==generation)return;const result=await runner.recognize(blob,message=>{
    if(current!==generation)return;if(message.progress!==null)$('doc-progress').value=message.progress;
    status(message.status==='recognizing text'?'Reconhecendo texto local… '+Math.round((message.progress||0)*100)+'%':'Preparando OCR local…');
   });
   if(current!==generation)return;ocrImage={rotation,crop:{...crop},original_width:original.width,original_height:original.height,adjusted_width:canvas.width,adjusted_height:canvas.height};ocrHash=digest;
   $('doc-text').value=result.text;$('doc-confidence').textContent=result.confidence===null?'Confiança OCR indisponível; não é confiança clínica.':`Confiança retornada pelo OCR para a imagem: ${result.confidence}. Não é confiança clínica nem por campo.`;
   makeCandidates(result.text);$('doc-progress').value=1;status(candidates.length?'OCR concluído. Confira imagem e campos; nada está confirmado ou enviado.':'OCR concluído sem campos reconhecíveis. Não é validação clínica; ajuste a imagem ou use o formulário manual existente.');
  }catch(error){if(current===generation)status(error.name==='AbortError'?'OCR cancelado; nenhum dado enviado.':'Falha no OCR local. Nenhum dado enviado; tente novamente ou ajuste a imagem.');}
  finally{busy=false;controls();}
 });
 $('doc-cancel').addEventListener('click',()=>{invalidate(true);stopCamera();status('OCR/câmera cancelados. Nenhum campo enviado por esta ação.');});
 $('doc-clear').addEventListener('click',()=>{if(pending()){status('Resolva primeiro o lote pendente; seus IDs não serão descartados.');return;}stopCamera();clearImage();status('Imagem e revisão descartadas.');});
 $('doc-camera').addEventListener('click',async()=>{
  if(!allowed()||busy)return;stopCamera();const current=cameraGeneration;
  if(!navigator.mediaDevices?.getUserMedia){status('Câmera não suportada neste contexto; selecione um arquivo.');return;}
  status('Aguardando permissão da câmera. Cancelar continua disponível.');
  try{const media=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
   if(current!==cameraGeneration){media.getTracks().forEach(track=>track.stop());return;}stream=media;$('doc-video').srcObject=stream;$('doc-video').hidden=false;await $('doc-video').play();$('doc-capture').hidden=false;$('doc-stop-camera').hidden=false;status('Câmera local ativa; capture um quadro sintético ou feche a câmera.');
  }catch{stopCamera();status('Não foi possível acessar a câmera (permissão, dispositivo ou contexto seguro). Use arquivo; nenhum dado foi enviado.');}
 });
 $('doc-stop-camera').addEventListener('click',()=>{stopCamera();status('Câmera fechada.');});
 $('doc-capture').addEventListener('click',async()=>{
  if(!stream||!allowed())return;const video=$('doc-video'),frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;
  if(!frame.width||!frame.height){status('A câmera ainda não forneceu um quadro.');return;}frame.getContext('2d').drawImage(video,0,0);const capture=new Date().toISOString();
  const blob=await new Promise(resolve=>frame.toBlob(resolve,'image/png'));stopCamera();try{await load(blob,capture);}catch{status('Quadro inválido; selecione arquivo ou tente novamente.');}
 });
 $('doc-candidates').addEventListener('input',event=>{const fieldset=event.target.closest('fieldset');if(fieldset&&event.target.type!=='checkbox')fieldset.querySelector('[data-field=reviewed]').checked=false;$('doc-send-confirm').checked=false;});
 $('doc-candidates').addEventListener('change',()=>{$('doc-send-confirm').checked=false;});
 for(const id of ['doc-photo-at','doc-document-at'])$(id).addEventListener('input',()=>invalidate());
 $('doc-send').addEventListener('click',()=>{
  try{
   const reject=message=>{throw Object.assign(new Error('Review required'),{reviewMessage:message});};
   if(!allowed()||!ocrImage||!$('doc-send-confirm').checked||!state.unitId||!state.encounterId)reject('Envio bloqueado: escolha unidade e episódio e confirme a revisão do destino e dos campos.');
   const reviewedAt=new Date().toISOString(),rows=[];
   candidates.forEach((candidate,index)=>{
    const field=name=>$(`doc-field-${index}-${name}`);if(!field('reviewed').checked)return;
    const value=field('value').value;if(!value.trim()||!field('time').value)reject(`Envio bloqueado: ${candidate.concept}, linha ${candidate.line}, precisa de valor e horário próprio da medição. Foto/documento não os substituem.`);
    const row={id:crypto.randomUUID(),unit_id:state.unitId,encounter_id:state.encounterId,concept:candidate.concept,value:Number(value.replace(',','.')),unit:field('unit').value.trim(),timestamp:new Date(field('time').value).toISOString(),confirmed:true,
     source:{version:1,document_id:documentId,image_sha256:originalHash,adjusted_sha256:ocrHash,candidate_key:candidate.key,raw_excerpt:candidate.excerpt,raw_value:candidate.rawValue,raw_unit:candidate.rawUnit,amendment_reason:field('reason').value.trim()||null,
      photo_at:asISO('doc-photo-at'),document_at:asISO('doc-document-at'),captured_at:capturedAt,reviewed_at:reviewedAt,time_source:'reviewer',...ocrImage,ocr_version:'tesseract.js/5.1.1 por'}};
    const rule=OslerValidation.rules[row.concept],episode=state.encounters.find(e=>e.id===state.encounterId);
    if(!Number.isFinite(row.value)||row.value<rule.min||row.value>rule.max||row.unit!==rule.unit)reject(`Envio bloqueado: ${candidate.concept}, linha ${candidate.line}: revise valor/faixa e unidade (${rule.unit||'grandeza sem unidade'}). Não há conversão automática.`);
    if(Date.parse(row.timestamp)<Date.parse(episode?.started_at)||Date.parse(row.timestamp)>Date.parse(reviewedAt))reject(`Envio bloqueado: ${candidate.concept}, linha ${candidate.line}: horário fora do episódio ou futuro. Não alteramos horários automaticamente.`);
    try{OslerDocumentReview.validate(row);}catch{reject(`Envio bloqueado: ${candidate.concept}, linha ${candidate.line}: confira a proveniência e justifique alterações de valor/unidade, inclusive unidade antes ausente.`);}rows.push(row);
   });
   if(!rows.length)reject('Envio bloqueado: nenhum campo foi selecionado e revisado.');void sendBatch(rows).catch(()=>status('Envio não totalmente confirmado. Confira os estados do lote; retome somente com os mesmos IDs.'));
  }catch(error){status(error.reviewMessage||'Envio bloqueado: confira horários e proveniência. Nada foi enviado por esta tentativa.');}
 });
 const attempt=promise=>{void promise.catch(()=>status('Operação não confirmada. Estados e IDs foram preservados; confira o acesso e a conexão.'));};
 $('doc-retry').addEventListener('click',()=>{if(!$('doc-retry-confirm').checked){status('Confirme a retomada do lote no destino fixo.');return;}attempt(retryBatch());});
 $('doc-verify').addEventListener('click',()=>attempt(verifyBatch()));$('doc-pause').addEventListener('click',pauseBatch);
 $('doc-discard-batch').addEventListener('click',()=>{if(confirm('Encerrar somente itens nunca enviados/recusados? Registros confirmados serão preservados.')){try{discardBatch();}catch{status('Resolva primeiro as solicitações ambíguas.');}}});
 $('doc-receipts').addEventListener('click',async()=>{const key=contextKey;try{const rows=await loadSources();if(key===contextKey)$('doc-receipt-list').textContent='Até 100 origens autorizadas; não comprova completude do episódio.\n'+JSON.stringify(rows,null,2);}catch{if(key===contextKey)$('doc-receipt-list').textContent='Consulta indisponível; confira sessão, unidade e episódio.';}});
 root.addEventListener('pagehide',()=>{runner.cancel();stopCamera();clearImage();});
 return {render};
}
root.OslerDocumentUI={create};
})(globalThis);
