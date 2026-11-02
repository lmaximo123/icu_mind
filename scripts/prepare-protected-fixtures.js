'use strict';
// Generate only metadata and administrative SQL. This script never runs SQL.
// The operator/agent must confirm the MCP project URL and schema before executing it.
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const projectUrl='https://otnwkxchugsovtjdanyu.supabase.co';
const fixture={projectUrl,runId:randomUUID(),unitP:randomUUID(),unitQ:randomUUID()};
const sql=`begin;
do $$ declare a uuid; b uuid; r uuid; begin
select id into strict a from auth.users where email='osler-synthetic-clinician-a@example.com';
select id into strict b from auth.users where email='osler-synthetic-clinician-b@example.com';
select id into strict r from auth.users where email='osler-synthetic-reader@example.com';
if exists(select 1 from public.units where id in ('${fixture.unitP}','${fixture.unitQ}')) then raise exception 'Fixture collision'; end if;
insert into public.units(id,label) values ('${fixture.unitP}','Synthetic protected P ${fixture.runId}'),('${fixture.unitQ}','Synthetic protected Q ${fixture.runId}');
if (select count(*) from osler_private.unit_security where unit_id in ('${fixture.unitP}','${fixture.unitQ}') and requires_mfa)=2 then
insert into public.unit_members(unit_id,user_id,role) values ('${fixture.unitP}',a,'clinician'),('${fixture.unitP}',b,'admin'),('${fixture.unitP}',r,'reader'),('${fixture.unitQ}',b,'clinician');
else raise exception 'MFA default absent'; end if;
end $$; commit;
`;
fs.mkdirSync('.test-artifacts',{recursive:true});
fs.writeFileSync('.test-artifacts/protected-fixtures.json',JSON.stringify(fixture,null,2)+'\n');
fs.writeFileSync('.test-artifacts/protected-fixtures.sql',sql);
console.log('Generated synthetic fixture metadata and SQL. No remote operation performed. Confirm development project and schema before executing SQL.');
