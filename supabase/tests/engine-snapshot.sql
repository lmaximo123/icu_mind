\set ON_ERROR_STOP on
begin;
create function pg_temp.engine_ok(value boolean) returns void language plpgsql as $$ begin
 if value is distinct from true then raise exception 'Engine snapshot assertion failed'; end if; end $$;
create function pg_temp.engine_denied(query text,expected text) returns void language plpgsql as $$ begin
 begin execute query; exception when others then if sqlstate=expected then return; end if;raise;end;
 raise exception 'Expected engine snapshot denial';end $$;
insert into auth.users(id) values('61000000-0000-4000-8000-000000000001'),('61000000-0000-4000-8000-000000000002');
insert into auth.sessions(id,user_id) values('63000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001'),('63000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002');
insert into public.units(id,label) values('62000000-0000-4000-8000-000000000001','Engine synthetic P'),('62000000-0000-4000-8000-000000000002','Engine synthetic Q');
insert into public.unit_members values('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','clinician'),('62000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002','reader');
insert into public.encounters(id,unit_id,bed_code,started_at) values
 ('64000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','001',now()),
 ('64000000-0000-4000-8000-000000000002','62000000-0000-4000-8000-000000000002','001',now());
set local role anon;
select pg_temp.engine_denied($q$select public.engine_snapshot('62000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',now(),now())$q$,'42501');
set local role authenticated;
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"aal":"aal1","session_id":"63000000-0000-4000-8000-000000000001"}',true);
select pg_temp.engine_denied($q$select public.engine_snapshot('62000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',now(),now())$q$,'42501');
select set_config('request.jwt.claims','{"aal":"aal2","session_id":"63000000-0000-4000-8000-000000000001"}',true);
select public.append_observation('65000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','creatinine',1,'mg/dL',now(),'manual');
select public.correct_observation('65000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000002',2,'mg/dL',now()+interval '1 minute','measurement');
-- Replacement moved outside selected window must still be visible for resolution.
select pg_temp.engine_ok((select (s->>'complete')::boolean and (s->>'event_count')::int=2 and (s->>'correction_count')::int=1 and jsonb_array_length(s->'events')=2
 from (select public.engine_snapshot('62000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',now(),now()) s) x));
select pg_temp.engine_denied($q$select public.engine_snapshot('62000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000001',now(),now())$q$,'42501');
select pg_temp.engine_denied($q$select public.engine_snapshot('62000000-0000-4000-8000-000000000002','64000000-0000-4000-8000-000000000002',now(),now())$q$,'42501');
select pg_temp.engine_denied($q$select public.engine_snapshot('62000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',now()-interval '32 days',now())$q$,'22023');
select pg_temp.engine_denied($q$select public.engine_snapshot('62000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',now()-interval '3 hours',now())$q$,'22023');
select set_config('request.jwt.claim.sub','61000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"aal":"aal2","session_id":"63000000-0000-4000-8000-000000000002"}',true);
select pg_temp.engine_ok((public.engine_snapshot('62000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',now(),now())->>'event_count')::int=2);
select pg_temp.engine_denied($q$select public.append_observation('65000000-0000-4000-8000-000000000003','64000000-0000-4000-8000-000000000001','creatinine',1,'mg/dL',now(),'manual')$q$,'42501');
reset role;
insert into public.observation_events(id,encounter_id,recorded_by,measured_at,concept,numeric_value,unit,source_type)
 select md5('engine-bound-'||n)::uuid,'64000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001',now(),'weight',72,'kg','manual' from generate_series(1,999) n;
set local role authenticated;
select pg_temp.engine_ok((select not (s->>'complete')::boolean and (s->>'event_count')::int=1001 and jsonb_array_length(s->'events')=1000
 from (select public.engine_snapshot('62000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001',now(),now()) s) x));
reset role;
select pg_temp.engine_ok((select not prosecdef and provolatile='s' and proconfig=array['search_path=""']::text[] from pg_proc where oid='public.engine_snapshot(uuid,uuid,timestamptz,timestamptz)'::regprocedure));
rollback;
