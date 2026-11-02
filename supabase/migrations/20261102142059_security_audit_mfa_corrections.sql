-- Development-only additive security foundation. No existing clinical event is modified.
create schema if not exists osler_private;
revoke all on schema osler_private from public, anon, authenticated;

create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  label text not null check(length(label) between 1 and 120),
  environment text not null default 'synthetic' check(environment='synthetic')
);
insert into public.institutions(id,label) values
 ('43ad3794-5328-4dcb-8237-f691b6b3a370','Osler synthetic development');
alter table public.institutions enable row level security;
revoke all on public.institutions from public,anon,authenticated;
grant select on public.institutions to authenticated;
alter table public.units add column institution_id uuid references public.institutions(id)
 default '43ad3794-5328-4dcb-8237-f691b6b3a370';
-- The default is explicitly the synthetic institution, never a patient/clinical mapping.
alter table public.units alter column institution_id set not null;
create index units_institution_id on public.units(institution_id);

create table osler_private.unit_security (
 unit_id uuid primary key references public.units(id),
 requires_mfa boolean not null default true
);
alter table osler_private.unit_security enable row level security;
revoke all on osler_private.unit_security from public,anon,authenticated;
insert into osler_private.unit_security(unit_id,requires_mfa)
 select id, not (id in ('9a10442f-2b57-4fd0-a1ed-f0666757e436','71db0d26-773e-45bf-8cdc-bf506b7bf0a7')) from public.units;
-- Only the two pre-existing, explicitly synthetic compatibility fixtures permit AAL1.
create function osler_private.configure_unit() returns trigger
 language plpgsql security definer set search_path='' as $$
begin
 insert into osler_private.unit_security(unit_id) values(new.id);
 return new;
end $$;
revoke all on function osler_private.configure_unit() from public,anon,authenticated;
create trigger units_security_default after insert on public.units
 for each row execute function osler_private.configure_unit();

create or replace function public.can_access_unit(target_unit uuid, write_access boolean default false)
 returns boolean language sql stable security definer set search_path='' as $$
 select exists (
  select 1 from public.unit_members m join osler_private.unit_security s on s.unit_id=m.unit_id
  where m.unit_id=target_unit and m.user_id=(select auth.uid())
   and (not write_access or m.role in ('clinician','admin'))
   and ((not s.requires_mfa and m.role<>'admin') or (
      (select auth.jwt()->>'aal')='aal2'
      and exists(select 1 from auth.sessions a
        where a.id::text=(select auth.jwt()->>'session_id') and a.user_id=(select auth.uid())
          and (a.not_after is null or a.not_after>now()))
   ))
 )
$$;
revoke all on function public.can_access_unit(uuid,boolean) from public,anon;
grant execute on function public.can_access_unit(uuid,boolean) to authenticated;
create policy institutions_read on public.institutions for select to authenticated using
 (exists(select 1 from public.units u where u.institution_id=institutions.id and public.can_access_unit(u.id,false)));

create table public.observation_corrections (
 replacement_event_id uuid primary key references public.observation_events(id),
 original_event_id uuid not null references public.observation_events(id),
 recorded_by uuid not null references auth.users(id),
 reason_code text not null check(reason_code in ('transcription','unit','measurement','other')),
 created_at timestamptz not null default now(),
 check(replacement_event_id<>original_event_id)
);
create index observation_corrections_original on public.observation_corrections(original_event_id);
create index observation_corrections_author on public.observation_corrections(recorded_by);
alter table public.observation_corrections enable row level security;
revoke all on public.observation_corrections from public,anon,authenticated;
grant select on public.observation_corrections to authenticated;
create policy corrections_read on public.observation_corrections for select to authenticated using
 (exists(select 1 from public.observation_events o where o.id=original_event_id));
create trigger observation_corrections_immutable before update or delete on public.observation_corrections
 for each row execute function public.reject_observation_mutation();
create function public.correct_observation(original_event uuid,replacement_event uuid,
 replacement_value numeric,replacement_unit text,replacement_time timestamptz,reason text)
 returns public.observation_events language plpgsql security definer set search_path='' as $$
declare original public.observation_events; episode public.encounters; link public.observation_corrections;
 result public.observation_events;
begin
 select * into original from public.observation_events where id=original_event;
 select * into episode from public.encounters where id=original.encounter_id for update;
 if episode.id is null or not public.can_access_unit(episode.unit_id,true) then
  raise exception 'Access denied' using errcode='42501';
 end if;
 if reason is null or reason not in ('transcription','unit','measurement','other') then
  raise exception 'Invalid correction' using errcode='23514'; end if;
 select * into link from public.observation_corrections where replacement_event_id=replacement_event;
 if link.replacement_event_id is not null and
   (link.original_event_id<>original_event or link.reason_code<>reason or link.recorded_by<>auth.uid()) then
  raise exception 'Correction ID already used' using errcode='23505'; end if;
 if exists(select 1 from public.observation_events where id=replacement_event) and link.replacement_event_id is null then
  raise exception 'Event ID already used' using errcode='23505'; end if;
 result:=public.append_observation(replacement_event,episode.id,original.concept,replacement_value,
   replacement_unit,replacement_time,'manual');
 if link.replacement_event_id is null then
  insert into public.observation_corrections(replacement_event_id,original_event_id,recorded_by,reason_code)
   values(replacement_event,original_event,auth.uid(),reason);
 end if;
 return result;
end $$;
revoke all on function public.correct_observation(uuid,uuid,numeric,text,timestamptz,text) from public,anon;
grant execute on function public.correct_observation(uuid,uuid,numeric,text,timestamptz,text) to authenticated;

create table osler_private.audit_events (
 id bigint generated always as identity primary key,
 occurred_at timestamptz not null default clock_timestamp(),
 actor_id uuid,
 unit_id uuid,
 entity text not null,
 entity_id uuid,
 operation text not null check(operation in ('INSERT','UPDATE','DELETE'))
);
create index audit_events_unit_time on osler_private.audit_events(unit_id,occurred_at desc);
alter table osler_private.audit_events enable row level security;
revoke all on osler_private.audit_events from public,anon,authenticated;
create function osler_private.audit_mutation() returns trigger
 language plpgsql security definer set search_path='' as $$
declare record_json jsonb; target_unit uuid; target_id uuid;
begin
 record_json:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 target_id:=coalesce(record_json->>'id',record_json->>'replacement_event_id',record_json->>'unit_id')::uuid;
 if tg_table_name='units' then target_unit:=target_id;
 elsif tg_table_name in ('encounters','unit_members','unit_security') then target_unit:=(record_json->>'unit_id')::uuid;
 elsif tg_table_name='observation_events' then
  select unit_id into target_unit from public.encounters where id=(record_json->>'encounter_id')::uuid;
 elsif tg_table_name='observation_corrections' then
  select e.unit_id into target_unit from public.observation_events o join public.encounters e on e.id=o.encounter_id where o.id=(record_json->>'replacement_event_id')::uuid;
 end if;
 insert into osler_private.audit_events(actor_id,unit_id,entity,entity_id,operation)
 values(auth.uid(),target_unit,tg_table_name,target_id,tg_op);
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function osler_private.audit_mutation() from public,anon,authenticated;
create trigger units_audit after insert or update or delete on public.units for each row execute function osler_private.audit_mutation();
create trigger members_audit after insert or update or delete on public.unit_members for each row execute function osler_private.audit_mutation();
create trigger encounters_audit after insert or update or delete on public.encounters for each row execute function osler_private.audit_mutation();
create trigger observations_audit after insert on public.observation_events for each row execute function osler_private.audit_mutation();
create trigger corrections_audit after insert on public.observation_corrections for each row execute function osler_private.audit_mutation();
create trigger security_audit after insert or update or delete on osler_private.unit_security for each row execute function osler_private.audit_mutation();
create trigger audit_events_immutable before update or delete on osler_private.audit_events for each row execute function public.reject_observation_mutation();
create trigger audit_events_no_truncate before truncate on osler_private.audit_events for each statement execute function public.reject_observation_mutation();
create function public.audit_unit(target_unit uuid,row_limit integer default 100)
 returns table(occurred_at timestamptz,actor_id uuid,entity text,entity_id uuid,operation text)
 language plpgsql security definer set search_path='' as $$
begin
 if row_limit is null or row_limit<1 or row_limit>100 or not public.can_access_unit(target_unit,true)
 or not exists(select 1 from public.unit_members where unit_id=target_unit and user_id=auth.uid() and role='admin') then
  raise exception 'Access denied' using errcode='42501'; end if;
 return query select a.occurred_at,a.actor_id,a.entity,a.entity_id,a.operation from osler_private.audit_events a
 where a.unit_id=target_unit order by a.occurred_at desc,a.id desc limit row_limit;
end $$;
revoke all on function public.audit_unit(uuid,integer) from public,anon;
grant execute on function public.audit_unit(uuid,integer) to authenticated;
