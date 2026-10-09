# Realtime Troubleshooting Reproduction

## Purpose

This local-only exercise demonstrates that a successful API update and a persisted PostgreSQL row do not guarantee immediate delivery to a Supabase Realtime subscriber.

It investigates the publication, logical replication, subscription state, JWT identity, RLS, and client subscription configuration.

## Run the demo

Start the local stack, load local credentials into Git Bash, and run:

```bash
eval "$(npx supabase status -o env | sed -E 's/^([A-Z0-9_]+)=/export \1=/')"
npm run demo:realtime
```

The demo creates temporary Customer and Agent users in one tenant, subscribes as the customer, updates the case as the agent, verifies the database row, asserts delivery, and removes all temporary data.

## Initial symptom

The initial run showed:

1. Customer created a case through the API.
2. Agent updated the case status through the API.
3. An independent service-role read confirmed the row existed with `status = 'in_progress'`.
4. The Realtime channel reported `SUBSCRIBED`.
5. No status-change event arrived before the timeout.

The temporary data cleanup still completed.

## Investigation

### Publication

```bash
docker exec supabase_db_supabase-support-case-dashboard psql -U postgres -d postgres -c "select pubname, schemaname, tablename from pg_publication_tables where pubname = 'supabase_realtime';"
```

Confirmed:

```text
supabase_realtime | public | support_cases
```

### WAL and logical replication

```bash
docker exec supabase_db_supabase-support-case-dashboard psql -U postgres -d postgres -c "show wal_level; select slot_name, plugin, active from pg_replication_slots; select application_name, state from pg_stat_replication;"
```

Confirmed:

- `wal_level` was `logical`.
- The Supabase Realtime replication slot was active.
- The Realtime replication connection was `streaming`.

### JWT and RLS path

The subscriber signs Customer A in through Supabase Auth, receives a JWT session, and calls:

```js
await client.realtime.setAuth(session.access_token)
```

The normal Data API path could read the case, confirming Customer A’s JWT identity and standard RLS access.

### Subscription configuration

The initial update occurred immediately after the channel reported `SUBSCRIBED`. Repeating the same scenario produced inconsistent results, which identified a local subscription-readiness race.

The final demo waits three seconds after subscription before updating:

```js
await waitForSubscription(channel)
await wait(3000)
```

The final subscriber also avoids the server-side UUID filter observed to suppress delivery in this local setup. Instead, it checks the case ID in the callback:

```js
if (payload.new.id !== caseId) return
```

## State reconciliation after subscription

The local investigation observed a timing gap: a channel can report `SUBSCRIBED` before the controlled write is reliably delivered to this local client.

The controlled Realtime demo preserves its explicit three-second wait before its test update:

```js
await waitForSubscription(channel)
await wait(3000)
```

That delay is a local-demo mitigation only. It is not a production dashboard-loading strategy.

The dashboard client uses the resilience pattern instead:

1. Authenticate with the signed-in user's JWT.
2. Establish the Realtime channel and wait for `SUBSCRIBED`.
3. Immediately query `support_cases` and `case_updates` through the normal RLS-scoped Data API.
4. Render that current PostgreSQL state.
5. Re-query and render again when later permitted Realtime changes arrive.

This means the dashboard does not depend on receiving a single initial Realtime event in order to display the current authorized state.

## Manual verification

1. Sign in with an authorized customer or support-agent account.
2. Start the dashboard client and confirm `SUBSCRIBED`.
3. Verify its initial output lists only the cases and permitted updates returned by the reconciliation query.
4. Create or update a permitted case or case update from another authorized client.
5. Verify the dashboard logs a Realtime-driven refresh and renders the new PostgreSQL state.
6. Sign in as a user from a different tenant and verify they cannot read the first user's cases or updates. The existing `npm run test:authorization` script automates the authorization checks.

## Current customer read policy

The final migration simplifies customer case visibility to direct row ownership:

```sql
create policy "support cases: customer can read own cases"
on public.support_cases
for select
to authenticated
using (customer_id = auth.uid());
```

The insert policy still requires customer role and tenant membership when a case is created, and a trigger prevents later changes to `customer_id` or `tenant_id`.

## Verified result

The final demo produces:

```text
Realtime subscription status: SUBSCRIBED
✓ Agent updated the case in the same tenant
✓ Updated case row exists in PostgreSQL with status in_progress
Received Realtime event: UPDATE in_progress
✓ Customer received the permitted Realtime status-change event
```

## WAL and logical replication, at a high level

PostgreSQL records changes in its write-ahead log (WAL). Logical replication converts selected changes into a stream that Supabase Realtime can consume. The `supabase_realtime` publication identifies the tables available to that stream.

For RLS-protected tables, Realtime must still evaluate whether the subscribing user may read a changed row before delivering it.

## Scope

This is a local learning reproduction. It demonstrates a practical Realtime investigation and a working status subscriber.

It does not claim that the original timeout was conclusively caused by RLS. A deterministic fault-injection replay that deliberately denies `SELECT` access and then restores the policy remains outside this time-boxed MVP.