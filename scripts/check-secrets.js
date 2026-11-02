'use strict';
// Inspect Git-tracked paths/content only; never read local .env or print a match.
const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
let failed=false;
for(const file of files){
 if((/(^|\/)\.env(?:\.|$)/.test(file) && file!=='.env.example') || /^(node_modules|vendor|\.test-artifacts)\//.test(file)){
  console.error('Forbidden tracked path: '+file);failed=true;continue;
 }
 if(!/\.(js|json|md|sql|toml|yml|html|css)$/.test(file))continue;
 const text=fs.readFileSync(file,'utf8');
 if(/sb_secret_[A-Za-z0-9_-]{24,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)){
  console.error('Potential secret found in tracked file (value suppressed): '+file);failed=true;
 }
}
const historic=execFileSync('git',['log','HEAD','--format=','--name-only','--','.env','.env.test'],{encoding:'utf8'}).trim();
if(historic){console.error('A private environment path exists in this branch history (content not read).');failed=true;}
if(failed)process.exitCode=1;else console.log('Tracked paths and branch environment-file history passed secret checks; no local credentials read.');
