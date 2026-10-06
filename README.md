# Supabase Support-Case Dashboard

A small, local-first Supabase learning project that demonstrates PostgreSQL, Supabase Auth/JWT, Row Level Security (RLS), and Realtime through a multi-tenant support-case dashboard.

The goal is to practice diagnosing a realistic support scenario—not to build a large production application.

## MVP scope

The MVP will include:

- `profiles` for application users, tenant assignment, and roles
- `support_cases` for customer-submitted cases and status tracking
- `case_updates` for case conversation/history
- Customer and support-agent roles
- Auth-based access with JWT-backed requests
- RLS policies for user and tenant isolation
- Realtime subscriptions for support-case status changes
- A minimal JavaScript subscriber
- Positive and negative authorization tests
- A reproducible Realtime/RLS troubleshooting scenario

Out of scope: payments, a polished frontend, microservices, external integrations, hosted deployment, and production-scale infrastructure.

## Architecture

```text
JavaScript client
  │
  ├─ Supabase Auth → JWT
  │
  ├─ Data API → PostgreSQL tables → RLS policy evaluation
  │
  └─ Realtime subscription ← supabase_realtime publication ← PostgreSQL WAL
```

The database is the source of truth. The client uses Supabase Auth to establish identity, then sends its JWT with database and Realtime requests. PostgreSQL RLS determines which rows that identity may read or change.

## Data model and access model

`profiles` extends the Supabase-managed `auth.users` identity with:

- `id` — matches `auth.users.id`
- `tenant_id` — identifies the customer organization
- `role` — `customer` or `support_agent`

`support_cases` records the tenant, submitting customer, title, description, and status.

`case_updates` records status changes and internal/customer-visible case messages.

The intended RLS model is:

- A customer can view and create only their own cases and related updates.
- A support agent can access cases and updates only for their assigned tenant.
- A user cannot read or modify another tenant’s data.
- A user cannot impersonate another customer by supplying a different user ID in an API request.

## Authentication versus authorization

Authentication answers: **who is this user?**

Supabase Auth verifies credentials and issues a JWT for the authenticated user.

Authorization answers: **may this user perform this action on this row?**

RLS policies enforce authorization in PostgreSQL. A valid JWT alone does not grant access to every row; each query must satisfy the applicable policy.

## JWT claims

The key claim for row ownership is `sub`, the authenticated user ID exposed in SQL through `auth.uid()`.

The JWT also contains a database/API role claim such as `authenticated`. That is separate from this application’s customer/support-agent role, which is stored in `profiles` and checked by RLS policies.

The browser client uses only the anon/publishable key and the signed-in user’s JWT. Service-role credentials bypass RLS and are intentionally outside this MVP’s client flow.

## RLS policies

RLS will be enabled on all application tables.

Policies will use `auth.uid()` and the caller’s `profiles` row to enforce:

- self-only profile access
- customer ownership of support cases
- support-agent access limited to matching `tenant_id`
- case-update access derived from access to the parent case

Tests will include both expected successes and expected denials so that tenant isolation is demonstrated rather than assumed.

## Realtime, publications, and subscriptions

The client will use a Supabase Realtime Postgres Changes channel to subscribe to updates on `support_cases`, filtered to the relevant tenant or case where appropriate.

For database changes to be streamed, `support_cases` must be included in the `supabase_realtime` publication. A browser subscription must also be authenticated with a JWT whose RLS policies allow the subscribed user to select the changed row.

At a high level, PostgreSQL writes changes to the write-ahead log (WAL). Logical replication exposes relevant row changes from that log to Supabase Realtime, which evaluates access and delivers permitted events to connected subscribers.

## Realtime troubleshooting scenario

This project will document and reproduce the following investigation:

1. An API insert or update succeeds.
2. The row is confirmed in PostgreSQL.
3. A Realtime event is not delivered after an RLS policy change.
4. The investigation verifies:
   - `support_cases` is in the `supabase_realtime` publication
   - the client channel and subscription are active
   - the client has the expected JWT/user identity
   - the relevant `SELECT` RLS policy permits the affected row
5. The incorrect policy is corrected and the Realtime event resumes.

This demonstrates why a successful database write does not by itself prove that a subscriber is authorized to receive the row change.

## Local development

This project runs locally and is not linked to a hosted Supabase project.

```bash
npx supabase start
npx supabase status
```

This repository uses a separate local port range so it can run alongside other Supabase projects:

- API: `55321`
- PostgreSQL: `55322`
- Studio: `55323`
- Mail testing UI: `55324`
- Analytics: `55327`

Do not commit local keys, tokens, or environment files.

## Current status

Currently demonstrated:

- Local Supabase CLI and Docker setup
- Local Auth, database, and Realtime services
- Project-specific ports that allow coexistence with another local Supabase project

Planned in the next branches:

- Database migrations and RLS policies
- Auth test users and authorization tests
- Minimal JavaScript Realtime subscriber
- The documented RLS/Reatime troubleshooting reproduction