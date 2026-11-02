'use strict';
const {randomUUID}=require('node:crypto');
function row(){return {id:randomUUID(),unit_id:randomUUID(),encounter_id:randomUUID(),concept:'weight',value:72,unit:'kg',timestamp:new Date(Date.now()-1000).toISOString(),confirmed:true,source:{version:1,document_id:randomUUID(),image_sha256:'a'.repeat(64),adjusted_sha256:'b'.repeat(64),candidate_key:'line:0:item:0',raw_excerpt:'Peso: 72 kg',raw_value:'72',raw_unit:'kg',amendment_reason:null,photo_at:null,document_at:null,captured_at:null,reviewed_at:new Date().toISOString(),time_source:'reviewer',rotation:0,crop:{x:0,y:0,width:1200,height:550},original_width:1200,original_height:550,adjusted_width:1200,adjusted_height:550,ocr_version:'tesseract.js/5.1.1 por'}};}
module.exports={row};
