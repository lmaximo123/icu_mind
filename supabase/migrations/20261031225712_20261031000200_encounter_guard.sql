-- Prevent reassignment of an encounter to another unit/bed after creation.
create or replace function public.prevent_encounter_reassignment()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id
     or new.unit_id is distinct from old.unit_id
     or new.bed_code is distinct from old.bed_code
     or new.started_at is distinct from old.started_at then
    raise exception 'Encounter identity is immutable';
  end if;
  if old.ended_at is not null and new.ended_at is distinct from old.ended_at then
    raise exception 'Closed encounter cannot be reopened or changed';
  end if;
  return new;
end $$;
create trigger encounters_identity_guard before update on public.encounters
for each row execute function public.prevent_encounter_reassignment();

-- Avoid exposing arbitrary source references or attachments in this schema.
alter table public.observation_events
  add constraint observation_source_ref_length check (source_reference is null or length(source_reference)<=256);
