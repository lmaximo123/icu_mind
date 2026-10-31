-- Trigger helpers are invoked by PostgreSQL, never through the browser RPC API.
revoke execute on function public.manage_encounter_clock() from public, anon, authenticated;
revoke execute on function public.prevent_encounter_reassignment() from public, anon, authenticated;
revoke execute on function public.reject_observation_mutation() from public, anon, authenticated;
-- Hosted projects can install this event trigger independently of app migrations.
do $$ begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;
