revoke execute on function public.can_access_unit(uuid,boolean) from anon;
create index if not exists unit_members_user_id on public.unit_members(user_id);
create index if not exists observation_events_recorded_by on public.observation_events(recorded_by);
