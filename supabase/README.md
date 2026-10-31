# Osler secure backend — development scaffold

This is **not deployed or connected**. The public Vercel app continues to use local IndexedDB. Do not enter identifiable patient information.

## Setup, after owner creates a development Supabase project
1. Use a dedicated development project with synthetic data only.
2. Enable Auth with verified institutional identities and MFA policy. Disable public signup unless specifically approved.
3. Apply migrations in filename order using Supabase CLI/SQL editor in the development project.
4. Provision units and unit_members **only** from a trusted administrative environment, never from public browser code. Service-role credentials must remain server-side.
5. Verify RLS with at least two separate units, two users, and a reader user. Cross-unit SELECT/INSERT must fail, reader INSERT must fail, and event UPDATE/DELETE must fail.
6. Create an authenticated server API that validates session, unit membership, encounter, value, unit, timestamp and review status before inserting events. Never connect clinical records directly from this public frontend.
7. Configure backups, restore drills, access logs, incident response and retention before a production pilot.
8. Run privacy/security and institutional governance review before any real patient data.

## Data model
- `units`: clinical units
- `unit_members`: access control by unit
- `encounters`: bed occupancy episodes; one active encounter per bed
- `observation_events`: confirmed, timestamped, append-only numeric observations

No patient names or identifiers are stored in this initial schema. Do not infer patient identity from a bed number. A future authorized patient identity mapping requires separate design and review.

## Security warning
RLS is a defense layer, not a substitute for authenticated API validation, audited administrative provisioning, data protection assessments, or operational testing. This migration is an initial design requiring a security review and integration tests against a real PostgreSQL/Supabase environment.
