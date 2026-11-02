-- Synthetic development: bounded, atomic read under caller RLS. No new data writes.
create function public.engine_snapshot(target_unit uuid,target_episode uuid,window_start timestamptz,window_end timestamptz)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare episode public.encounters; result jsonb;
begin
 if window_start is null or window_end is null or window_start>window_end or
    window_end-window_start>interval '31 days' or window_end>statement_timestamp() then
  raise exception 'Invalid analysis interval' using errcode='22023';
 end if;
 select * into episode from public.encounters e where e.id=target_episode and e.unit_id=target_unit;
 if not found then raise exception 'Context unavailable' using errcode='42501'; end if;
 if window_start<episode.started_at or (episode.ended_at is not null and window_end>episode.ended_at) then
  raise exception 'Interval outside episode' using errcode='22023';
 end if;
 -- STABLE shares the calling statement's MVCC snapshot across every SELECT.
 -- Read whole episode, including links/events outside the chosen measured interval:
 -- a correction may move a measurement out of that interval.
 with event_rows as materialized (
  select o.* from public.observation_events o where o.encounter_id=target_episode
 ), link_rows as materialized (
  select c.* from public.observation_corrections c join event_rows o on o.id=c.original_event_id
 ), event_page as (select * from event_rows order by id limit 1000),
 link_page as (select * from link_rows order by replacement_event_id limit 1000)
 select jsonb_build_object('schema_version',1,'snapshot_version','1.0.0','as_of',statement_timestamp(),
  'reviewer_id',auth.uid(),'unit_id',target_unit,'encounter',to_jsonb(episode),
  'window_start',window_start,'window_end',window_end,'row_limit',1000,
  'event_count',(select count(*) from event_rows),'correction_count',(select count(*) from link_rows),
  'complete',(select count(*)<=1000 from event_rows) and (select count(*)<=1000 from link_rows),
  'coverage','stored-episode-only',
  'events',coalesce((select jsonb_agg(to_jsonb(p) order by p.id) from event_page p),'[]'::jsonb),
  'corrections',coalesce((select jsonb_agg(to_jsonb(p) order by p.replacement_event_id) from link_page p),'[]'::jsonb)) into result;
 return result;
end $$;
revoke all on function public.engine_snapshot(uuid,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.engine_snapshot(uuid,uuid,timestamptz,timestamptz) to authenticated;
