-- ADMIN SETUP ONLY on otnwkxchugsovtjdanyu after official Auth user creation.
-- No auth.users writes, role changes, existing-row updates or deletions.
-- The caller must verify the project URL before executing this file.
begin;
do $$
declare
  reader_id uuid;
  clinician_a uuid;
  clinician_b uuid;
begin
  select id into strict reader_id from auth.users where email='osler-synthetic-reader@example.com';
  select id into strict clinician_a from auth.users where email='osler-synthetic-clinician-a@example.com';
  select id into strict clinician_b from auth.users where email='osler-synthetic-clinician-b@example.com';
  insert into public.units(id,label) values
    ('9a10442f-2b57-4fd0-a1ed-f0666757e436','Osler synthetic security validation A'),
    ('71db0d26-773e-45bf-8cdc-bf506b7bf0a7','Osler synthetic security validation B')
    on conflict(id) do nothing;
  if (select count(*) from public.units where
    (id='9a10442f-2b57-4fd0-a1ed-f0666757e436' and label='Osler synthetic security validation A') or
    (id='71db0d26-773e-45bf-8cdc-bf506b7bf0a7' and label='Osler synthetic security validation B')) <> 2 then
    raise exception 'Fixture unit ID collision; no existing rows changed';
  end if;
  -- Refuse unexpected pre-existing access instead of rewriting memberships.
  if exists (select 1 from public.unit_members
    where unit_id in ('9a10442f-2b57-4fd0-a1ed-f0666757e436','71db0d26-773e-45bf-8cdc-bf506b7bf0a7')
    and not (
      (unit_id='9a10442f-2b57-4fd0-a1ed-f0666757e436' and user_id=clinician_a and role='clinician') or
      (unit_id='71db0d26-773e-45bf-8cdc-bf506b7bf0a7' and user_id=clinician_b and role='clinician') or
      (unit_id='9a10442f-2b57-4fd0-a1ed-f0666757e436' and user_id=reader_id and role='reader')
    )) then
    raise exception 'Unexpected fixture membership; no existing rows changed';
  end if;
  insert into public.unit_members(unit_id,user_id,role) values
    ('9a10442f-2b57-4fd0-a1ed-f0666757e436',clinician_a,'clinician'),
    ('71db0d26-773e-45bf-8cdc-bf506b7bf0a7',clinician_b,'clinician'),
    ('9a10442f-2b57-4fd0-a1ed-f0666757e436',reader_id,'reader')
    on conflict(unit_id,user_id) do nothing;
end $$;
commit;
