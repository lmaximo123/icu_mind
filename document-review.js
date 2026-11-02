/* Strict OCR candidates and reviewed document payloads. No drafts, inference or network. */
(function(root){'use strict';
const validation=typeof module!=='undefined'&&module.exports?require('./osler-validation.js'):root.OslerValidation;
const aliases=[['creatinine','creatinina'],['weight','peso'],['ph','ph'],['pao2','pao2'],['paco2','paco2'],['fio2','fio2'],['spo2','spo2'],['sbp','pas'],['map','pam'],['heartRate','fc'],['temperature','temperatura'],['sodium','sodio'],['potassium','potassio'],['respiratoryRate','fr']];
const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function candidates(text){
 if(typeof text!=='string'||text.length>50000)throw Error('OCR text too large');
 const found=[];
 text.split(/\r?\n/).forEach((line,index)=>{
  const normalized=normalize(line);
  for(const [concept,label] of aliases){
   const match=new RegExp('(?:^|[^a-z0-9])'+label+'\\s*[:=]?\\s*(-?\\d+(?:[.,]\\d+)?)\\s*([^;|]*)','i').exec(normalized);
   if(!match)continue;
   // Keep the source spelling/case, no guessed units or decimal corrections.
   const start=match.index+match[0].indexOf(match[1]);
   const value=line.slice(start,start+match[1].length);
   const unit=line.slice(start+value.length).trim().split(/[;|]/)[0].trim()||null;
   found.push({key:`line:${index}:item:${found.length}`,concept,rawValue:value,rawUnit:unit,excerpt:line.slice(0,1000),line:index+1});
  }
 });
 return found.slice(0,20);
}
const sourceKeys=['version','document_id','image_sha256','adjusted_sha256','candidate_key','raw_excerpt','raw_value','raw_unit','amendment_reason','photo_at','document_at','captured_at','reviewed_at','time_source','rotation','crop','original_width','original_height','adjusted_width','adjusted_height','ocr_version'];
const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function validate(row){
 if(!row||!uuid(row.id)||!uuid(row.unit_id)||!uuid(row.encounter_id)||row.confirmed!==true||!Object.hasOwn(validation.rules,row.concept)||!iso(row.timestamp)||validation.validate({[row.concept]:row}).reviewRequired)throw Error('Reviewed measurement required');
 const s=row.source;
 if(!s||Array.isArray(s)||Object.keys(s).length!==sourceKeys.length||sourceKeys.some(k=>!Object.hasOwn(s,k))||s.version!==1||!uuid(s.document_id)||
  !/^[a-f0-9]{64}$/.test(s.image_sha256)||!/^[a-f0-9]{64}$/.test(s.adjusted_sha256)||!/^line:\d+:item:\d+$/.test(s.candidate_key)||
  typeof s.raw_excerpt!=='string'||!s.raw_excerpt.trim()||s.raw_excerpt.length>1000||
  (s.raw_value!==null&&(typeof s.raw_value!=='string'||s.raw_value.length>50))||(s.raw_unit!==null&&(typeof s.raw_unit!=='string'||s.raw_unit.length>80))||
  (s.amendment_reason!==null&&(typeof s.amendment_reason!=='string'||s.amendment_reason.length>240))||s.time_source!=='reviewer'||s.ocr_version!=='tesseract.js/5.1.1 por'||
  !iso(s.reviewed_at)||Date.parse(row.timestamp)>Date.parse(s.reviewed_at)||Date.parse(s.reviewed_at)>Date.now()+300000||
  ![0,90,180,270].includes(s.rotation))throw Error('Invalid document provenance');
 for(const k of ['photo_at','document_at','captured_at'])if(s[k]!==null&&(!iso(s[k])||Date.parse(s[k])>Date.now()+300000))throw Error('Invalid source timestamp');
 for(const k of ['original_width','original_height','adjusted_width','adjusted_height'])if(!Number.isInteger(s[k])||s[k]<1||s[k]>8000)throw Error('Invalid image dimensions');
 if(s.original_width*s.original_height>16000000||s.adjusted_width*s.adjusted_height>16000000)throw Error('Image too large');
 if(!s.crop||Object.keys(s.crop).sort().join(',')!=='height,width,x,y'||Object.values(s.crop).some(v=>!Number.isInteger(v))||s.crop.x<0||s.crop.y<0||s.crop.width<1||s.crop.height<1)throw Error('Invalid crop');
 const rotated=s.rotation%180?{width:s.original_height,height:s.original_width}:{width:s.original_width,height:s.original_height};
 if(s.crop.x+s.crop.width>rotated.width||s.crop.y+s.crop.height>rotated.height||s.crop.width!==s.adjusted_width||s.crop.height!==s.adjusted_height)throw Error('Crop outside source');
 const originalNumber=typeof s.raw_value==='string'&&/^-?\d+(?:[.,]\d+)?$/.test(s.raw_value)?Number(s.raw_value.replace(',','.')):null;
 if((originalNumber!==row.value||s.raw_unit!==row.unit)&&!s.amendment_reason?.trim())throw Error('Explicit amendment reason required');
 if(JSON.stringify(s).length>8000)throw Error('Source too large');
 return row;
}
const api={candidates,validate,canonical,sourceKeys};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OslerDocumentReview=api;
})(globalThis);
