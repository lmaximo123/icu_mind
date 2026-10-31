-- Osler development-only foundation. Requires Supabase Auth.
-- Do not use with identifiable clinical data before institutional review.
create extension if not exists pgcrypto;

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(label) between 1 and 120),
  created_at timestamptz not null default now()
);
create table if not exists public.unit_members (
  unit_id uuid not null references public.units(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('reader','clinician','admin')),
  primary key(unit_id,user_id)
);
create table if not exists public.encounters (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  bed_code text not null check (bed_code ~ '^[0-9]{2,3}$'),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create unique index if not exists encounters_one_active_per_bed
  on public.encounters(unit_id,bed_code) where ended_at is null;
create table if not exists public.observation_events (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters(id),
  recorded_by uuid not null references auth.users(id),
  measured_at timestamptz not null,
  created_at timestamptz not null default now(),
  concept text not null check (concept ~ '^[a-z][a-z0-9_]{1,63}$'),
  numeric_value numeric not null,
  unit text not null check (length(unit) between 1 and 40),
  source_type text not null check (source_type in ('manual','device','laboratory','document')),
  source_reference text,
  review_status text not null default 'confirmed' check (review_status = 'confirmed'),
  check (measured_at <= created_at + interval '5 minutes')
);
create index if not exists observation_events_encounter_time
  on public.observation_events(encounter_id,measured_at desc);

create or replace function public.can_access_unit(target_unit uuid, write_access boolean default false)
returns boolean language sql stable security definer
set search_path = '' as $$
  select exists (
    select 1 from public.unit_members m
    where m.unit_id = target_unit and m.user_id = (select auth.uid())
      and (not write_access or m.role in ('clinician','admin'))
  )
$$;
revoke all on function public.can_access_unit(uuid,boolean) from public;
grant execute on function public.can_access_unit(uuid,boolean) to authenticated;

alter table public.units enable row level security;
alter table public.unit_members enable row level security;
alter table public.encounters enable row level security;
alter table public.observation_events enable row level security;

create policy units_read on public.units for select to authenticated
  using (public.can_access_unit(id,false));
create policy members_read on public.unit_members for select to authenticated
  using (public.can_access_unit(unit_id,false));
create policy encounters_read on public.encounters for select to authenticated
  using (public.can_access_unit(unit_id,false));
create policy encounters_create on public.encounters for insert to authenticated
  with check (public.can_access_unit(unit_id,true));
create policy encounters_update on public.encounters for update to authenticated
  using (public.can_access_unit(unit_id,true))
  with check (public.can_access_unit(unit_id,true));
create policy observations_read on public.observation_events for select to authenticated
  using (exists (
    select 1 from public.encounters e where e.id=encounter_id
    and public.can_access_unit(e.unit_id,false)
  ));
create policy observations_create on public.observation_events for insert to authenticated
  with check (
    recorded_by=(select auth.uid())
    and exists (
      select 1 from public.encounters e where e.id=encounter_id
      and e.ended_at is null and public.can_access_unit(e.unit_id,true)
    )
  );
-- No UPDATE/DELETE policies for observations: append-only event records.
-- Memberships and units are provisioned only through a trusted admin backend.
-- Never expose service_role keys to browser code.
