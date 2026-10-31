\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAILED: %', message; end if;
end $$;
create function pg_temp.expect_error(query text, expected text) returns void language plpgsql as $$
begin
  begin
    execute query;
  exception when others then
    if sqlstate = expected then return; end if;
    raise exception 'Expected SQLSTATE %, got %: %', expected, sqlstate, sqlerrm;
  end;
  raise exception 'Expected SQLSTATE %, query succeeded', expected;
end $$;
insert into auth.users values
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002'),
 ('10000000-0000-0000-0000-000000000003');
insert into public.units(id,label) values
 ('20000000-0000-0000-0000-000000000001','Synthetic A'),
 ('20000000-0000-0000-0000-000000000002','Synthetic B');
insert into public.unit_members values
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','clinician'),
 ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','clinician'),
 ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','reader');
insert into public.encounters(id,unit_id,bed_code,started_at) values
 ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','01',now()-interval '1 hour'),
 ('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','01',now()-interval '1 hour');

set local role anon;
select pg_temp.expect_error('select * from public.encounters','42501');
select pg_temp.expect_error($q$select public.append_observation(gen_random_uuid(),'30000000-0000-0000-0000-000000000001','ph',7.4,'',now(),'manual')$q$,'42501');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select pg_temp.assert_true((select count(*)=1 from public.units),'unit isolation');
select pg_temp.assert_true((select count(*)=1 from public.encounters),'encounter isolation');
select pg_temp.assert_true((select started_at=now() and ended_at is null from public.encounters),'database controls encounter clock');
select pg_temp.expect_error($q$insert into public.encounters(unit_id,bed_code) values('20000000-0000-0000-0000-000000000002','02')$q$,'42501');
select pg_temp.expect_error($q$insert into public.encounters(unit_id,bed_code) values('20000000-0000-0000-0000-000000000001','01')$q$,'23505');
select pg_temp.expect_error($q$update public.encounters set bed_code='03'$q$,'P0001');
select pg_temp.expect_error($q$insert into public.unit_members values('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','admin')$q$,'42501');
select pg_temp.expect_error($q$insert into public.observation_events default values$q$,'42501');

select public.append_observation('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','ph',7.4,'',now(),'manual');
select public.append_observation('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','ph',7.4,'',now(),'manual');
select pg_temp.assert_true((select count(*)=1 from public.observation_events),'retry is idempotent');
select pg_temp.assert_true((select recorded_by=auth.uid() from public.observation_events),'author bound to session');
select pg_temp.expect_error($q$select public.append_observation('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','ph',7.5,'',now(),'manual')$q$,'23505');
select pg_temp.expect_error($q$select public.append_observation(gen_random_uuid(),'30000000-0000-0000-0000-000000000002','ph',7.4,'',now(),'manual')$q$,'42501');
select pg_temp.expect_error($q$select public.append_observation(gen_random_uuid(),'30000000-0000-0000-0000-000000000001','fio2',0.3,'%',now(),'manual')$q$,'23514');
select pg_temp.expect_error($q$select public.append_observation(gen_random_uuid(),'30000000-0000-0000-0000-000000000001','ph',9,'',now(),'manual')$q$,'23514');
select pg_temp.expect_error($q$select public.append_observation(gen_random_uuid(),'30000000-0000-0000-0000-000000000001','ph','NaN','',now(),'manual')$q$,'23514');
select pg_temp.expect_error($q$select public.append_observation(gen_random_uuid(),'30000000-0000-0000-0000-000000000001','unknown',1,'',now(),'manual')$q$,'23514');
select pg_temp.expect_error($q$select public.append_observation(gen_random_uuid(),'30000000-0000-0000-0000-000000000001','ph',7.4,'',now()+interval '1 hour','manual')$q$,'23514');
select pg_temp.expect_error($q$select public.append_observation(gen_random_uuid(),'30000000-0000-0000-0000-000000000001','ph',7.4,'',now()-interval '2 hours','manual')$q$,'23514');
select pg_temp.expect_error('update public.observation_events set numeric_value=7.5','42501');
select pg_temp.expect_error('delete from public.observation_events','42501');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select pg_temp.assert_true((select count(*)=0 from public.observation_events),'cross-unit events invisible');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select pg_temp.assert_true((select count(*)=1 from public.observation_events),'reader can read');
select pg_temp.expect_error($q$select public.append_observation(gen_random_uuid(),'30000000-0000-0000-0000-000000000001','ph',7.4,'',now(),'manual')$q$,'42501');
select pg_temp.expect_error($q$insert into public.encounters(unit_id,bed_code) values('20000000-0000-0000-0000-000000000001','02')$q$,'42501');
with changed as (update public.encounters set ended_at=now() returning *)
select pg_temp.assert_true((select count(*)=0 from changed),'reader cannot close');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
update public.encounters set ended_at=now() where id='30000000-0000-0000-0000-000000000001';
select pg_temp.expect_error($q$select public.append_observation(gen_random_uuid(),'30000000-0000-0000-0000-000000000001','ph',7.4,'',now(),'manual')$q$,'23514');
-- A retry of an already-committed record remains safe after closure.
select public.append_observation('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','ph',7.4,'',now(),'manual');
select pg_temp.expect_error($q$update public.encounters set ended_at=null$q$,'P0001');
reset role;
-- Even privileged accidental updates/deletions cannot rewrite the audit events.
select pg_temp.expect_error('update public.observation_events set numeric_value=7.5','23514');
select pg_temp.expect_error('delete from public.observation_events','23514');
rollback;
\echo 'All database security assertions passed (synthetic fixtures rolled back).'
