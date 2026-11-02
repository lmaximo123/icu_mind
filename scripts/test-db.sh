#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Explicitly target only the local daemon. Never use a remote Docker context.
docker_local() {
  env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    docker --host=unix:///var/run/docker.sock "$@"
}
container="osler-db-test-$$"
trap 'docker_local rm -f "$container" >/dev/null 2>&1 || true' EXIT
# No published port and no outbound network. Trust auth is confined to this
# disposable container; never use these settings for a persistent database.
docker_local run -d --name "$container" --network none \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17-bookworm >/dev/null
ready=false
for attempt in {1..30}; do
  if docker_local exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then docker_local logs "$container"; exit 1; fi
sql() { docker_local exec -i "$container" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres; }
sql < supabase/tests/bootstrap.sql
for migration in supabase/migrations/*.sql; do sql < "$migration"; done
sql < supabase/tests/security.sql
sql < supabase/tests/advanced-security.sql
sql < supabase/tests/durability.sql
docker_local restart "$container" >/dev/null
ready=false
for attempt in {1..30}; do
  if docker_local exec "$container" pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
if [ "$ready" != true ]; then docker_local logs "$container"; exit 1; fi
sql <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',false);
do $$ begin
  if not exists (select 1 from public.observation_events
    where id='40000000-0000-0000-0000-000000000001' and numeric_value=7.4 and concept='ph') then
    raise exception 'Committed observation was lost during restart';
  end if;
end $$;
\echo 'Durability assertion passed after database restart.'
SQL
