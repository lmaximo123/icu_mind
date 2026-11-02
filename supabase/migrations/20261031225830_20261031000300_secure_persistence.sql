-- Explicit privileges: do not depend on project-specific default grants.
revoke all on public.units, public.unit_members, public.encounters,
  public.observation_events from anon, authenticated;
grant select on public.units, public.unit_members to authenticated;
grant select, insert, update on public.encounters to authenticated;
grant select on public.observation_events to authenticated;

-- Do not let direct REST callers forge episode creation/closure times.
create function public.manage_encounter_clock()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.started_at := now();
    new.ended_at := null;
  elsif old.ended_at is null and new.ended_at is not null then
    new.ended_at := now();
  end if;
  return new;
end $$;
-- Alphabetical trigger ordering preserves the existing identity guard first.
create trigger encounters_managed_clock before insert or update on public.encounters
for each row execute function public.manage_encounter_clock();

-- Dimensionless measurements (e.g. pH) use the empty unit string in the app.
alter table public.observation_events drop constraint observation_events_unit_check;
alter table public.observation_events add constraint observation_events_unit_check
  check (length(unit) <= 40);
alter table public.observation_events add constraint observation_value_finite
  check (numeric_value::text not in ('NaN', 'Infinity', '-Infinity'));

create function public.reject_observation_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Observation events are immutable' using errcode = '23514';
end $$;
create trigger observation_events_immutable before update or delete
on public.observation_events for each row execute function public.reject_observation_mutation();

-- One controlled write path. Locking the encounter serializes closure and append.
-- Retry with the same event ID and payload returns the original event.
create function public.append_observation(
  event_id uuid, target_encounter uuid, observation_concept text,
  observation_value numeric, observation_unit text, observation_time timestamptz,
  observation_source text default 'manual'
) returns public.observation_events
language plpgsql security definer set search_path = '' as $$
declare
  episode public.encounters;
  previous public.observation_events;
  result public.observation_events;
  lower_bound numeric;
  upper_bound numeric;
  expected_unit text;
begin
  select * into episode from public.encounters where id = target_encounter for update;
  if episode.id is null or not public.can_access_unit(episode.unit_id, true) then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  select * into previous from public.observation_events where id = event_id;
  if previous.id is not null then
    if previous.encounter_id = target_encounter and previous.recorded_by = auth.uid()
       and previous.concept = observation_concept and previous.numeric_value = observation_value
       and previous.unit = observation_unit and previous.measured_at = observation_time
       and previous.source_type = observation_source then
      return previous;
    end if;
    raise exception 'Event ID already used' using errcode = '23505';
  end if;
  if episode.ended_at is not null then
    raise exception 'Encounter is closed' using errcode = '23514';
  end if;
  select r.lo, r.hi, r.u into lower_bound, upper_bound, expected_unit
  from (values
    ('ph',6.5,8.2,''), ('pao2',15,700,'mmHg'), ('paco2',10,150,'mmHg'),
    ('fio2',0.21,1,'fraction'), ('peep',0,35,'cmH2O'), ('spo2',40,100,'%'),
    ('heart_rate',20,250,'bpm'), ('temperature',25,43,'°C'),
    ('sbp',40,300,'mmHg'), ('map',20,200,'mmHg'),
    ('sodium',90,200,'mmol/L'), ('potassium',1,10,'mmol/L'),
    ('creatinine',0.1,30,'mg/dL'), ('weight',1,500,'kg'),
    ('tidal_volume',50,2000,'mL'), ('respiratory_rate',1,80,'rpm')
  ) as r(c,lo,hi,u) where r.c = observation_concept;
  if expected_unit is null or observation_unit is distinct from expected_unit
     or observation_value is null or observation_value::text in ('NaN','Infinity','-Infinity')
     or observation_value < lower_bound or observation_value > upper_bound
     or observation_time is null or observation_time < episode.started_at
     or observation_time > now() + interval '5 minutes'
     or observation_source is null or observation_source not in ('manual','device','laboratory','document') then
    raise exception 'Invalid observation' using errcode = '23514';
  end if;
  insert into public.observation_events(id,encounter_id,recorded_by,concept,numeric_value,unit,measured_at,source_type)
  values(event_id,target_encounter,auth.uid(),observation_concept,observation_value,observation_unit,observation_time,observation_source)
  returning * into result;
  return result;
end $$;
revoke all on function public.append_observation(uuid,uuid,text,numeric,text,timestamptz,text) from public, anon;
grant execute on function public.append_observation(uuid,uuid,text,numeric,text,timestamptz,text) to authenticated;

-- Only the controlled function inserts observations, even if project default
-- privileges would otherwise grant table INSERT on newly created tables.
drop policy observations_create on public.observation_events;
