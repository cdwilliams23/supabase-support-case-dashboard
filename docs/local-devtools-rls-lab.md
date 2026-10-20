# Local DevTools RLS Lab

This local-only fixture tool creates two temporary customer users, each in a different tenant with one support case. It is intended for practicing and inspecting tenant isolation with browser DevTools, the Supabase Data API, and PostgreSQL.

It is separate from the automated authorization test and from the Realtime readiness-race demo.

## Safety boundary

The setup script refuses to run unless the Supabase URL hostname is `localhost` or `127.0.0.1`.

It uses the local service-role key only to create and clean up temporary fixture users and rows. The application authorization model still uses the anon/publishable key, authenticated user JWT, grants, and RLS.

The script writes temporary IDs to `.devtools-lab-state.json`, which is ignored by Git. The temporary password is printed once during setup and is not written to disk.

## Prerequisites

Start local Supabase services and load the local credentials:

```bash
npx supabase start
eval "$(npx supabase status -o env | sed -E 's/^([A-Z0-9_]+)=/export \1=/')"