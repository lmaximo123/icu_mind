# Osler — development backend

Not deployed. Existing scores, OCR, audio, backups and local IndexedDB remain available.
An optional, separate panel now supports explicit remote persistence in development.
Use synthetic data only. This is not clinical production readiness.

## Validate locally

Requirements: Node.js >=22. Run `npm ci --ignore-scripts` and `npm run build`
before serving. The optional native database runner requires Bash/Docker;
`node scripts/test-restore.js` uses isolated PostgreSQL WASM without them.

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
3. The local migration versions match the development project's history:
   `20261031225711`, `20261031225712`, `20261031225830`,
   `20261031230035`, `20261031230053`.
   PR #1's filenames shared the CLI version prefix `20261031`.
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

Data `/api/*` requests require `Authorization: Bearer <user-access-token>`.
`GET /api/auth/config` is public; opt-in `POST /api/auth/login` accepts synthetic
credentials. `POST /api/auth/logout` requires the current access token.
No cookie authentication, token logging or token persistence is added. Responses
use `no-store`; writes accept JSON up to 16 KiB. Errors hide database details.

| Method | Path | Input |
| --- | --- | --- |
| GET | `/api/units` | Units visible to the authenticated user |
| GET | `/api/encounters?unit_id=<uuid>` | Explicit unit |
| POST | `/api/encounters` | `id`, `unit_id`, `bed_code` (2–3 digits) |
| POST | `/api/encounters/<uuid>/close` | No fields required |
| GET | `/api/observations?encounter_id=<uuid>` | Explicit encounter |
| POST | `/api/observations` | Confirmed observation |

Lists return up to 100 rows by default, not a complete history export. Lists
can also be queried in bounded pages using `limit` (1–100) and `offset`
(0–100000), with stable UUID tie-break ordering. Lists remain bounded by default.
Inaccessible IDs
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
trigger prevents accidental privileged mutation. An additive correction RPC and
`POST /api/observations/correct` are now prepared and tested locally: the original
is preserved, the replacement is another validated event and a reason-code link
records provenance. This requires the pending security migration below; it is
not claimed as active remotely and has no automatic correction UI.

## Opt-in UI integration

The page loads `backend-client.js`, `remote-session.js` and `remote-ui.js`. The
remote panel is disabled unless the development server is explicitly enabled:

```powershell
$env:OSLER_ENABLE_REMOTE_UI='1'
node --env-file=.env.test server/index.js
```

Open `http://127.0.0.1:3000/`, expand **Persistência remota**, and log in with an
officially provisioned synthetic account. The server refuses this feature for
any project other than `otnwkxchugsovtjdanyu`, and accepts only publishable keys
and `osler-synthetic-…@example.com` accounts. No signup route exists. The local
static-only workflow still works when the API is absent or disabled.

The UI uses same-origin password login and local-scope logout via the official
Supabase Auth endpoints. Access tokens stay in memory only; no cookies, refresh
tokens in the browser, localStorage, sessionStorage or IndexedDB session
persistence is added. A bounded server-only memory vault retains refresh tokens
for a technical maximum of two hours from login, coalesces concurrent renewal
and rotates issued material. Automatic renewal before expiry and an explicit
renew button use `/api/auth/refresh`; restarting the server loses this vault and
requires login again. Reload still requires login. Existing verified TOTP factors
can be challenged through `/api/auth/mfa` and the UI; enrollment/recovery remain
controlled official Auth operations, not public signup. Issued JWTs can remain
valid until expiration after logout on the legacy synthetic fixtures. The pending
protected-unit database policy additionally checks active Auth sessions. Do not
deploy this synthetic-only login publicly.

Select a unit and an episode explicitly, or deliberately create a new synthetic
episode in that unit. The local bed selector does not choose a remote episode.
The remote form accepts a reviewed numeric measurement, canonical unit, time
and source; confirmation is required. Success appears only after the API returns
the matching event ID, author, episode, value and unit. Refresh reads the latest
100 remote records without updating local notes or clinical scores.

An uncertain observation write retains its UUID and original payload in memory;
retry uses the same payload even if form input changes. Destination and fields
are locked until confirmed or explicitly discarded. An uncertain episode insert
is recovered by its original UUID before retrying creation. Users are warned
before discarding pending attempts, leaving the page or logging out with one.
Pending IDs are lost on a forced reload: check the server history before creating
another event. A same-account login after expiry can resume the in-memory attempt.

No IndexedDB draft, image, audio or note is automatically uploaded. Remote fields
are excluded from local draft capture. Remote failures never report local save as
remote success. A reader's rejected write and an empty close response are errors,
not confirmations. Closure requires an explicit action and confirmation dialog.

Audited draft migration, pagination controls in the UI, attachments, institutional
SSO/MFA/recovery policies, external audit retention and hosted backup restoration
remain separate work. See [security report](../docs/security-foundation.md).

### Real browser validation

With the synthetic users, fixtures and write opt-in configured below, run:

```sh
node --env-file=.env.test scripts/test-remote-browser.js
```

This uses installed Chrome headless (Windows default path, or set `CHROME_PATH`),
a temporary profile and an ephemeral loopback API against the authorized project.
It verifies login/logout, explicit selection, two reviewed observations in A,
simulated response loss after commit followed by an idempotent UI retry, a real
page reload, fresh login and recovery of the exact same two event IDs and payloads
in the original episode. It also creates a separate episode in B using the same
bed label and verifies bidirectional isolation. UI selectors exclude the other
unit; explicit requests from the authenticated browser cannot read, append,
create or close records across units. Reader checks run while A is still open:
read succeeds but observation append, episode creation and closure fail.

The suite also verifies no persisted browser session and byte-identical local
IndexedDB drafts. It retains three new synthetic observations across two new
episodes, then closes only those generated episodes. Existing records are not
modified. Sessions
and the temporary profile are cleaned up, including on failure. Assets are now
self-hosted. The browser also recognizes a generated synthetic PNG through the
local Portuguese OCR worker/model/WASM, records fake-device audio, exercises real
TOTP step-up with an execution-owned temporary factor, renews the session and
checks no external HTTP origin or credential/clinical data in API audit events.
This is a functional OCR check, not an OCR accuracy validation dataset. Credentials,
TOTP secrets/codes and CDP payloads are not logged or persisted.

Validation for this integration: 33 local tests passed, the real Chrome smoke
check passed against development Auth/PostgREST, and the hosted write/isolation
suite passed again. No synthetic episodes were left open. The browser check also
confirmed that remote form interactions did not modify IndexedDB drafts; it waits
for the existing local asynchronous score calculation before taking its baseline.

The expanded browser persistence/isolation suite was executed successfully with
the three configured synthetic accounts against `otnwkxchugsovtjdanyu`. All
scenarios above passed, as did the 33 local tests. Reload was verified to create
a new document, clear the UI session and require a fresh login and explicit
unit/episode selection; it did not trigger another observation write. Both event
IDs, all returned observation fields and the rendered history matched the
pre-reload baseline. The same-bed episodes in A and B retained their respective
records unchanged after both cross-unit and reader mutation attempts. Both owners
then closed their own episodes, with cleanup also completing successfully.
This automated evidence is separate from the owner's manual report below.
Post-run database inspection confirmed the two newly generated same-bed episodes
were closed. An older episode in the fixture unit was still open and was left
untouched; cleanup does not close pre-existing episodes or delete observations.

Limitations: one installed Chrome headless browser and one development API
instance, not a cross-device or multi-browser test. It does not cover backup
restoration, MFA, refresh-token renewal, immediate JWT revocation, clinical score
validity or production behavior. Cross-unit forged requests use browser `fetch`
with the session obtained from the real UI login; they are distinct from normal
UI selection actions. Assertions compare data in memory without logging tokens,
passwords, CDP payloads or observation response bodies. The first write's lost
response is deliberately injected in the test server after the real database
commit; the persistence and authorization checks otherwise use real hosted Auth
and PostgREST.

### Manual persistence evidence reported by the owner

The owner reported the following manual validation after the UI integration:
two synthetic observations were saved, the page was reloaded, a fresh login was
performed, and both records remained available in the same remote episode.
This is owner-reported evidence, separate from the automated browser test; the
agent did not independently repeat or inspect that particular manual session.
No observation IDs, episode/unit IDs, execution timestamp or browser version were
provided, so none are inferred or recorded here. No credentials are recorded.

This supports persistence across page reload and reauthentication for the tested
episode. It does not establish backup restoration, cross-device behavior,
isolation for other accounts, score correctness or clinical readiness. The
authorized development scope remains project `otnwkxchugsovtjdanyu` and branch
`develop/osler-secure-foundation`.

The next proposed integration is described in
[Remote observations and score preview proposal](../docs/remote-score-proposal.md).
It is a proposal awaiting review; no remote-to-score bridge has been implemented.

## Hosted development smoke checks

Only use project `otnwkxchugsovtjdanyu` on branch
`develop/osler-secure-foundation`. With `SUPABASE_URL` and
`SUPABASE_PUBLISHABLE_KEY` supplied through the environment, run
`node scripts/test-hosted.js`. The script performs no clinical writes and refuses
other project URLs. It also starts an ephemeral loopback API and checks the
browser adapter through that API against hosted Auth, closing the server on exit.
Optional `OSLER_TEST_ACCESS_TOKEN` enables session and unit listing checks with
a synthetic user, both directly and through the browser adapter/local API.
It does not validate authenticated writes, MFA or isolation between units.

Investigation on 2026-10-31 reproduced the `hosted signup policy` failure:
hosted `/auth/v1/settings` returned `disable_signup: false`, with
`mailer_autoconfirm: false` and `external.anonymous_users: false`.
Email verification and disabled anonymous sign-in do not disable public signup.
The local `[auth] enable_signup = false` does not configure hosted Auth.
After the owner disabled **Allow new users to sign up**, a fresh remote check
returned `disable_signup: true`, `mailer_autoconfirm: false` and
`external.anonymous_users: false`. The strict `disable_signup === true`
requirement remains in place.

The next check exposed Auth returning HTTP 403 with `error_code: bad_jwt` for
the malformed synthetic JWT. The smoke check accepts 401 or that specific 403
response; unrelated 403 errors, successful responses and service failures fail.
The rerun passed hosted Auth settings, invalid session, denied anonymous access
to all four tables, and missing/invalid session rejection through the browser
adapter/local API. No synthetic access token was available, so authenticated
hosted listing and writes remain unverified. No hosted data or configuration
was changed by these checks.

## Obtain a synthetic session without public signup

The available Supabase connector has SQL and migration tools, but no Auth admin
user-creation action. Do not insert into `auth.users` or manufacture JWTs.
Use the official administrative user creation flow, then the official password
grant (the REST equivalent of `signInWithPassword`):
[createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser),
[password login](https://supabase.com/docs/reference/javascript/auth-signinwithpassword).

1. Open project `otnwkxchugsovtjdanyu` in the Supabase dashboard and check the
   project reference before proceeding.
2. Go to **Authentication → Users → Add user → Create new user**.
3. Enter `osler-synthetic-reader@example.com` and generate a unique strong test
   password. Select **Auto Confirm User** for this synthetic account only, then
   create it. Do not change global email confirmation, MFA or public signup.
   If the dashboard uses **Add user** as the final button, use that button.
4. Do not add memberships yet: a new account can authenticate but should see no
   units. This does not validate the reader role until a membership is provisioned.
5. In a local editor, create `.env.test` in the repository root. It is ignored by
   Git. Put these variables there, using the actual password only in that file:

   ```dotenv
   SUPABASE_URL=https://otnwkxchugsovtjdanyu.supabase.co
   SUPABASE_PUBLISHABLE_KEY=<development publishable key from project API settings>
   OSLER_TEST_EMAIL=osler-synthetic-reader@example.com
   OSLER_TEST_PASSWORD=<unique synthetic password>
   OSLER_REQUIRE_AUTH=1
   ```

6. Run `node --env-file=.env.test scripts/test-hosted.js` with Node.js >=22.
   Do not paste credentials into chat, command arguments, screenshots or logs.
   Do not print the file. Delete its password entry after validation if no longer
   needed. No service-role or secret API key is required.

The script checks that public signup remains disabled before attempting login,
does not call signup, validates the synthetic identity through Auth, and checks
unit listing directly and through the browser adapter/local API. Credentials
and response details are never printed. A session created by the runner is
signed out in `finally` with local scope; externally supplied access tokens are
not signed out. Supabase may keep an issued access JWT valid until expiration:
this is not a test of immediate token revocation. Auth login/logout creates Auth
session records, but the runner does not write clinical tables.

Without credentials, `OSLER_REQUIRE_AUTH=1` makes the run fail, rather than claim
authenticated success. Authenticated writes, cross-unit isolation, reader write
denial, MFA, refresh and concurrent closure/idempotency still require dedicated
synthetic users and fixtures; successful unit listing alone does not prove them.

## Hosted synthetic write security suite

`scripts/test-hosted-writes.js` exercises real Auth, the browser adapter, local
HTTP API, PostgREST and database policies on the authorized development project.
It requires three distinct official Auth accounts:

| Account | Fixture membership |
| --- | --- |
| `osler-synthetic-reader@example.com` | reader in A |
| `osler-synthetic-clinician-a@example.com` | clinician in A |
| `osler-synthetic-clinician-b@example.com` | clinician in B |

Create the additional accounts using the same dashboard steps above, each with
its own password and account-specific Auto Confirm User. Keep public signup
disabled. Add these variables to the existing ignored `.env.test` in an editor:

```dotenv
OSLER_TEST_CLINICIAN_A_EMAIL=osler-synthetic-clinician-a@example.com
OSLER_TEST_CLINICIAN_A_PASSWORD=<unique password for A>
OSLER_TEST_CLINICIAN_B_EMAIL=osler-synthetic-clinician-b@example.com
OSLER_TEST_CLINICIAN_B_PASSWORD=<unique password for B>
OSLER_ALLOW_SYNTHETIC_WRITES=1
```

After verifying the connector project URL is exactly
`https://otnwkxchugsovtjdanyu.supabase.co`, execute
`supabase/tests/hosted-fixtures.sql` through the trusted administrative SQL
connection. This is fixture provisioning, not a schema migration. It creates two
dedicated units from `scripts/hosted-fixtures.json` and three memberships only;
it does not edit Auth tables, update existing rows or delete anything. It aborts
transactionally on missing accounts, ID collisions or unexpected memberships.
Never run this administrative fixture file in production.

Then run:

```sh
node --env-file=.env.test scripts/test-hosted-writes.js
```

The runner refuses other projects, secret keys, missing accounts and missing
write opt-in. It verifies signup remains disabled and all three identities and
fixture roles before clinical writes. Each invocation generates fresh episode
and observation UUIDs. No existing episode is closed or observation modified.
New synthetic episodes are closed on success and attempted in `finally` on
failure; immutable synthetic events are intentionally retained for inspection.
No triggers or policies are disabled for cleanup. The dedicated units and
memberships remain for reruns, and newly created sessions are signed out.

Checks include writes in both units with session-bound authors; racing first
attempts plus sequential and concurrent retries; changed-payload conflict; bidirectional
read/write/closure isolation; reader read access with create/append/close denial;
direct observation insert/update/delete denial; closure, repeat closure, rejected
new events after closure and accepted original retries after closure. An empty
update result is checked against the owner's unchanged episode, rather than
treated as a permission error or proof of a successful close.

This does not cover MFA, refresh, immediate JWT revocation, browser UI, backup
restoration, large-list pagination or a first-write/closure race. Synthetic
fixtures are not evidence of clinical readiness. Hosted results must be reported
separately from local unit tests; a missing credential is a failed preflight,
never a passing security scenario.

Current validation status (2026-10-31): 24 local tests passed. After official
creation of the two clinician accounts, the dedicated units and memberships were
provisioned and the full hosted write suite passed, including all checks listed
above, episode cleanup and local-scope logout of the three sessions.

The first hosted attempt created two synthetic episodes but no observations:
the runner clock was behind the database, and JavaScript truncated the database
episode timestamp from microseconds to milliseconds. The test measurement could
therefore precede its episode by a fraction of a millisecond. Both episodes were
closed by cleanup. The runner now selects a synthetic timestamp at least one
millisecond after the parsed database start; a regression test covers this case.
Database timestamp validation and signup policy were not relaxed. The successful
rerun created two further episodes and two immutable observations, all retained
for inspection, with no episodes left open in the dedicated fixtures. Existing
data was preserved; no production resources were used.
