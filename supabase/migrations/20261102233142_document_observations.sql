-- Additive synthetic document provenance. No images, attachments, buckets or draft migration.
create table public.document_observation_sources (
 observation_id uuid primary key references public.observation_events(id),
 metadata jsonb not null check(jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=12000),
 created_at timestamptz not null default now()
);
alter table public.document_observation_sources enable row level security;
revoke all on public.document_observation_sources from public,anon,authenticated;
grant select on public.document_observation_sources to authenticated;
create policy document_sources_read on public.document_observation_sources for select to authenticated using
 (exists(select 1 from public.observation_events o where o.id=observation_id));
create trigger document_sources_immutable before update or delete on public.document_observation_sources
 for each row execute function public.reject_observation_mutation();
create trigger document_sources_no_truncate before truncate on public.document_observation_sources
 for each statement execute function public.reject_observation_mutation();
create function osler_private.audit_document_source() returns trigger language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
 select e.unit_id into target from public.observation_events o join public.encounters e on e.id=o.encounter_id where o.id=new.observation_id;
 insert into osler_private.audit_events(actor_id,unit_id,entity,entity_id,operation)
 values(auth.uid(),target,'document_observation_sources',new.observation_id,'INSERT');
 return new;
end $$;
revoke all on function osler_private.audit_document_source() from public,anon,authenticated;
create trigger document_sources_audit after insert on public.document_observation_sources for each row execute function osler_private.audit_document_source();
create function public.append_document_observation(event_id uuid,target_unit uuid,target_encounter uuid,observation_concept text,
 observation_value numeric,observation_unit text,observation_time timestamptz,source jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare episode public.encounters; previous public.observation_events; saved_source jsonb; k text; raw numeric; rw int; rh int;
begin
 select * into episode from public.encounters where id=target_encounter for update;
 if episode.id is null or episode.unit_id<>target_unit or not public.can_access_unit(target_unit,false) then raise exception 'Access denied' using errcode='42501';end if;
 if source is null or jsonb_typeof(source)<>'object' or octet_length(source::text)>12000 or
  not source ?& array['version','document_id','image_sha256','adjusted_sha256','candidate_key','raw_excerpt','raw_value','raw_unit','amendment_reason','photo_at','document_at','captured_at','reviewed_at','time_source','rotation','crop','original_width','original_height','adjusted_width','adjusted_height','ocr_version'] or
  (select count(*) from jsonb_object_keys(source))<>21 or jsonb_typeof(source->'version')<>'number' or coalesce(source->>'version','')<>'1' or coalesce(source->>'ocr_version','')<>'tesseract.js/5.1.1 por' or coalesce(source->>'time_source','')<>'reviewer' then
  raise exception 'Invalid document source' using errcode='22023';end if;
 if coalesce(source->>'image_sha256','')!~'^[a-f0-9]{64}$' or coalesce(source->>'adjusted_sha256','')!~'^[a-f0-9]{64}$' or
  coalesce(source->>'document_id','')!~*'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or
  coalesce(source->>'candidate_key','')!~'^line:[0-9]+:item:[0-9]+$' or
  jsonb_typeof(source->'raw_excerpt')<>'string' or length(btrim(source->>'raw_excerpt'))<1 or length(source->>'raw_excerpt')>1000 or
  jsonb_typeof(source->'raw_value') not in ('null','string') or length(source->>'raw_value')>50 or
  jsonb_typeof(source->'raw_unit') not in ('null','string') or length(source->>'raw_unit')>80 or
  jsonb_typeof(source->'amendment_reason') not in ('null','string') or length(source->>'amendment_reason')>240 then
  raise exception 'Invalid source fields' using errcode='22023';end if;
 foreach k in array array['photo_at','document_at','captured_at','reviewed_at'] loop
  if (k='reviewed_at' and source->>k is null) or
   (source->>k is not null and (jsonb_typeof(source->k)<>'string' or source->>k!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$')) then raise exception 'Invalid source time' using errcode='22023';end if;
  if source->>k is not null and (source->>k)::timestamptz>now()+interval '5 minutes' then raise exception 'Future source time' using errcode='22023';end if;
 end loop;
 if (source->>'reviewed_at')::timestamptz<observation_time then raise exception 'Review before measurement' using errcode='22023';end if;
 foreach k in array array['original_width','original_height','adjusted_width','adjusted_height'] loop
  if jsonb_typeof(source->k)<>'number' or coalesce(source->>k,'')!~'^[0-9]+$' or (source->>k)::numeric not between 1 and 8000 then raise exception 'Invalid dimensions' using errcode='22023';end if;
 end loop;
 if (source->>'original_width')::int*(source->>'original_height')::int>16000000 or (source->>'adjusted_width')::int*(source->>'adjusted_height')::int>16000000 or
  jsonb_typeof(source->'rotation')<>'number' or source->>'rotation' not in ('0','90','180','270') or jsonb_typeof(source->'crop')<>'object' or
  not (source->'crop') ?& array['x','y','width','height'] or (select count(*) from jsonb_object_keys(source->'crop'))<>4 then raise exception 'Invalid transform' using errcode='22023';end if;
 foreach k in array array['x','y','width','height'] loop
  if jsonb_typeof(source->'crop'->k)<>'number' or coalesce(source->'crop'->>k,'')!~'^[0-9]+$' or (source->'crop'->>k)::numeric>8000 then raise exception 'Invalid crop' using errcode='22023';end if;
 end loop;
 rw:=case when source->>'rotation' in ('90','270') then (source->>'original_height')::int else (source->>'original_width')::int end;
 rh:=case when source->>'rotation' in ('90','270') then (source->>'original_width')::int else (source->>'original_height')::int end;
 if (source->'crop'->>'width')::int<>(source->>'adjusted_width')::int or (source->'crop'->>'height')::int<>(source->>'adjusted_height')::int or
  (source->'crop'->>'x')::int+(source->'crop'->>'width')::int>rw or (source->'crop'->>'y')::int+(source->'crop'->>'height')::int>rh then raise exception 'Crop outside image' using errcode='22023';end if;
 if coalesce(source->>'raw_value','')~'^-?[0-9]+([.,][0-9]+)?$' then raw:=replace(source->>'raw_value',',','.')::numeric;end if;
 if (raw is distinct from observation_value or source->>'raw_unit' is distinct from observation_unit) and length(btrim(coalesce(source->>'amendment_reason','')))=0 then raise exception 'Amendment reason required' using errcode='22023';end if;
 select * into previous from public.observation_events where id=event_id;
 if previous.id is not null then
  if previous.encounter_id<>target_encounter or previous.recorded_by<>auth.uid() then raise exception 'Access denied' using errcode='42501';end if;
  select metadata into saved_source from public.document_observation_sources where observation_id=event_id;
  if saved_source is distinct from source or previous.concept<>observation_concept or previous.numeric_value<>observation_value or previous.unit<>observation_unit or previous.measured_at<>observation_time or previous.source_type<>'document' then
   raise exception 'Conflicting document retry' using errcode='23505';end if;
  return jsonb_build_object('event',to_jsonb(previous),'source',saved_source);
 end if;
 previous:=public.append_observation(event_id,target_encounter,observation_concept,observation_value,observation_unit,observation_time,'document');
 insert into public.document_observation_sources(observation_id,metadata) values(event_id,source);
 return jsonb_build_object('event',to_jsonb(previous),'source',source);
end $$;
revoke all on function public.append_document_observation(uuid,uuid,uuid,text,numeric,text,timestamptz,jsonb) from public,anon;
grant execute on function public.append_document_observation(uuid,uuid,uuid,text,numeric,text,timestamptz,jsonb) to authenticated;
