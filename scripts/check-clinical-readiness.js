'use strict';
// A fail-closed evidence checklist, not a deployment tool or clinical authorization.
const fs=require('node:fs');
const path=require('node:path');
const safeEvidence=file=>typeof file==='string' && /^(docs|scripts|tests|server|supabase)\/[a-zA-Z0-9_./-]+\.(md|json|js|sql)$/.test(file) && !file.split('/').includes('..');
function assess(document,{exists=file=>fs.existsSync(path.resolve(__dirname,'..',file))}={}){
 if(document.schema_version!==1 || document.project_ref!=='otnwkxchugsovtjdanyu' ||
    document.branch!=='develop/osler-secure-foundation' || document.environment!=='synthetic-only' ||
    document.clinical_use_authorized!==false)throw new Error('Invalid or unauthorized readiness scope');
 if(!Array.isArray(document.gates) || !Array.isArray(document.proven_synthetic_controls))throw new Error('Missing evidence inventory');
 const ids=new Set();
 const required=['hosted_restore','deletion_resistant_copy','permanent_mfa','independent_review','clinical_governance'];
 for(const gate of document.gates){
  if(ids.has(gate.id))throw new Error('Duplicate gate');ids.add(gate.id);
  if(!['absent','implemented_unverified','proven'].includes(gate.state) || !['P0','P1'].includes(gate.priority) ||
     typeof gate.required_for_real_data!=='boolean' || !Array.isArray(gate.evidence))throw new Error('Invalid gate classification');
  for(const field of ['owner','action','cost','description','availability'])if(typeof gate[field]!=='string'||!gate[field].trim())throw new Error('Missing owner/action/cost or scope');
  if(gate.state==='proven' && !gate.evidence.length)throw new Error('A claim of proof needs evidence');
  for(const file of gate.evidence)if(!safeEvidence(file)||!exists(file))throw new Error('Evidence file missing or outside scope');
 }
 for(const id of required)if(!document.gates.some(g=>g.id===id && g.priority==='P0' && g.required_for_real_data))throw new Error('Mandatory release gate removed');
 for(const control of document.proven_synthetic_controls){
  if(!control.id || ids.has(control.id) || !control.evidence?.length)throw new Error('Invalid synthetic evidence');ids.add(control.id);
  for(const file of control.evidence)if(!safeEvidence(file)||!exists(file))throw new Error('Synthetic evidence missing');
 }
 const unresolved=document.gates.filter(g=>g.required_for_real_data && g.state!=='proven');
 // No checklist change can itself grant institutional authorization.
 return {clinical_release:'blocked',scope:'synthetic-only',institutional_authorization:false,
  unresolved:unresolved.map(g=>({id:g.id,priority:g.priority,state:g.state,owner:g.owner,action:g.action,cost:g.cost})),
  note:'Synthetic test evidence is not authorization for real clinical data.'};
}
if(require.main===module){
 try{
  const report=assess(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../docs/clinical-release-gates.json'),'utf8')));
  console.log(JSON.stringify(report,null,2));
  process.exitCode=process.argv.includes('--validate-only')?0:2;
 }catch{console.error('Readiness evidence invalid; clinical release remains blocked.');process.exitCode=1;}
}
module.exports={assess};
