\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(value boolean) returns void language plpgsql as $$ begin
 if value is distinct from true then raise exception 'Security assertion failed'; end if; end $$;
create function pg_temp.denied(query text,expected text) returns void language plpgsql as $$ begin
 begin execute query; exception when others then
  if sqlstate=expected then return; end if; raise;
 end; raise exception 'Expected denial'; end $$;
insert into auth.users(id) values('50000000-0000-0000-0000-000000000001'),('50000000-0000-0000-0000-000000000002');
insert into auth.sessions(id,user_id) values
 ('51000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001'),
 ('51000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002');
insert into public.units(id,label) values('52000000-0000-0000-0000-000000000001','Synthetic MFA protected');
insert into public.unit_members values
 ('52000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','admin'),
 ('52000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000002','clinician');
set local role authenticated;
select set_config('request.jwt.claim.sub','50000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1","session_id":"51000000-0000-0000-0000-000000000001"}',true);
select pg_temp.ok(not public.can_access_unit('52000000-0000-0000-0000-000000000001',true));
select pg_temp.denied($q$insert into public.encounters(id,unit_id,bed_code) values('53000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','01')$q$,'42501');
select pg_temp.denied($q$select * from public.audit_unit('52000000-0000-0000-0000-000000000001')$q$,'42501');
select set_config('request.jwt.claims','{"aal":"aal2","session_id":"51000000-0000-0000-0000-000000000001"}',true);
select pg_temp.ok(public.can_access_unit('52000000-0000-0000-0000-000000000001',true));
insert into public.encounters(id,unit_id,bed_code) values('53000000-0000-0000-0000-000000000001','52000000-0000-0000-0000-000000000001','01');
select public.append_observation('54000000-0000-0000-0000-000000000001','53000000-0000-0000-0000-000000000001','ph',7.4,'',now(),'manual');
select public.correct_observation('54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000002',7.35,'',now(),'transcription');
select public.correct_observation('54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000002',7.35,'',now(),'transcription');
select pg_temp.ok((select count(*)=2 from public.observation_events));
select pg_temp.ok((select numeric_value=7.4 from public.observation_events where id='54000000-0000-0000-0000-000000000001'));
select pg_temp.denied($q$select public.correct_observation('54000000-0000-0000-0000-000000000001','54000000-0000-0000-0000-000000000002',7.35,'',now(),'other')$q$,'23505');
select pg_temp.ok((select count(*)>0 from public.audit_unit('52000000-0000-0000-0000-000000000001')));
select pg_temp.denied($q$select * from public.audit_unit('52000000-0000-0000-0000-000000000001',null)$q$,'42501');
select pg_temp.denied('select * from osler_private.audit_events','42501');
select pg_temp.denied($q$update public.unit_members set role='admin'$q$,'42501');
select set_config('request.jwt.claim.sub','50000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal2","session_id":"51000000-0000-0000-0000-000000000002"}',true);
select pg_temp.denied($q$select * from public.audit_unit('52000000-0000-0000-0000-000000000001')$q$,'42501');
reset role;
delete from auth.sessions where id='51000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.ok(not public.can_access_unit('52000000-0000-0000-0000-000000000001',false));
reset role;
select pg_temp.denied('delete from osler_private.audit_events','23514');
select pg_temp.denied('truncate osler_private.audit_events','23514');
rollback;
\echo 'Advanced MFA, session revocation, correction and audit assertions passed.'
