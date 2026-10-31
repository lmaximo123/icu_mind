# Osler — development backend

Not deployed. The existing UI, scores, OCR and IndexedDB remain unchanged.
Use synthetic data only. This is not clinical production readiness.

## Validate locally

Requirements: Node.js >=22, Bash, Docker with a local daemon. No npm dependencies.

```sh
node --test tests/*.test.js
bash scripts/test-db.sh
```

The database runner creates a disposable PostgreSQL 17 container without published
ports or outbound networking, stubs Supabase's `auth.users` and `auth.uid()`, applies
every migration, then tests RLS, author binding, validation, idempotency, encounter
closure, immutability and persistence across restart. It removes the container on
exit. This tests real PostgreSQL, but not hosted Supabase Auth or PostgREST.
Never run the test bootstrap on a Supabase project. CI runs both suites.

## Configure a dedicated Supabase development project

1. Select a development project. Configure verified institutional identities,
   disabled public signup, MFA policy and appropriate redirect URLs.
2. With an authenticated Supabase CLI, link that development project, inspect
   migration history, then apply pending migrations with `supabase db push`.
   Never link production. `config.toml` supplies local defaults; review hosted
   Auth settings separately.
3. The migration versions are now unique: `20261031000100`, `20261031000200`,
   `20261031000300`. PR #1's filenames shared the CLI version prefix `20261031`.
   If those old files were already applied remotely, reconcile the actual schema
   and migration history with the owner first. Do not replay or blindly repair them.
4. Provision `units` and `unit_members` through a trusted administrative session.
   Readers cannot write; clinicians/admins can manage encounters and append events.
   Membership management is never available through the browser API.
5. Supply `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` securely to the API process.
   No service-role key is needed. The publishable key does not authorize users:
   every request is verified through Auth and forwards the user's JWT to RLS.
6. From the repository root run `node server/index.js`. It listens on
   `127.0.0.1:3000` by default. `/health` indicates process liveness only.
   For local settings, create a gitignored `.env` based on `.env.example` and use
   `node --env-file=.env server/index.js`. Never commit real configuration values.
7. The development server serves the existing static application and `/api/*`
   under the same origin. Only an explicit list of public frontend assets is
   served; `.env`, backend source, Git metadata and archives are excluded. CORS
   is not enabled. HTTPS must terminate at a trusted ingress for remote use.
   Production routing/deployment is unchanged.
8. Test real Auth + PostgREST + API using synthetic users in separate units and a
   reader, including revoked sessions, retries and closure. Configure backups and
   test restoration before activating remote persistence for real data.

## API

All `/api/*` requests require `Authorization: Bearer <user-access-token>`.
No cookie authentication, token logging or token persistence is added. Responses
use `no-store`; writes accept JSON up to 16 KiB. Errors hide database details.

| Method | Path | Input |
| --- | --- | --- |
| GET | `/api/encounters?unit_id=<uuid>` | Explicit unit |
| POST | `/api/encounters` | `id`, `unit_id`, `bed_code` (2–3 digits) |
| POST | `/api/encounters/<uuid>/close` | No fields required |
| GET | `/api/observations?encounter_id=<uuid>` | Explicit encounter |
| POST | `/api/observations` | Confirmed observation |

Lists return the latest 100 rows, not a complete history export. Inaccessible IDs
yield empty lists. Closing an inaccessible/already closed encounter returns an
empty list; do not treat this as a new successful update. Duplicate encounter
creation returns a conflict; resolve against the existing ID instead of opening
another episode.

Observations contain `id` (UUID retained for retry), `encounter_id`, `concept`
(app key, e.g. `ph` or `heartRate`), `value` (finite number), canonical `unit`
(empty for pH), `timestamp` (ISO instant with timezone), `confirmed: true`, and
`source_type` (`manual`, `device`, `laboratory`, `document`). Author and creation
time come from the session/database. The API maps camelCase concepts to snake_case.

The `append_observation` RPC is the only authenticated event write path. It locks
the encounter to serialize with closure and validates membership, value, unit and
time. Identical retries return the original event, including after closure;
changed payloads with the same ID fail. Measurements before encounter creation or
new writes after closure fail. UPDATE/DELETE privileges are revoked; an additional
trigger prevents accidental privileged mutation. Corrections need a future
explicit superseding-event design.

## Opt-in UI integration

`backend-client.js` is not loaded automatically. After an authenticated UI exists,
load it explicitly and supply an in-memory session provider:

```js
const backend = OslerBackend.createClient({
  getAccessToken: async () => currentSession?.access_token
});
```

The UI must select an explicit unit/encounter, retain event IDs for retry and show
remote failures. Never infer an encounter from bed number alone. No existing
IndexedDB draft is automatically uploaded and failed remote writes never fall
back silently to a local success state. Login/MFA UI, audited draft migration,
pagination, attachments, operational audit, retention and backup restore remain
separate work. Hosted end-to-end validation requires a configured development
project and is not claimed by the local tests.
