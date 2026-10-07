create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated;

create or replace function private.is_current_user_customer_for_tenant(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = auth.uid()
      and p.tenant_id = target_tenant_id
      and p.role = 'customer'::public.app_role
  );
$$;

create or replace function private.is_support_agent_for_tenant(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = auth.uid()
      and p.tenant_id = target_tenant_id
      and p.role = 'support_agent'::public.app_role
  );
$$;

create or replace function private.is_current_user_customer_for_case(target_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_cases as c
    join public.profiles as p
      on p.id = c.customer_id
    where c.id = target_case_id
      and p.id = auth.uid()
      and p.role = 'customer'::public.app_role
  );
$$;

create or replace function private.is_support_agent_for_case(target_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.support_cases as c
    join public.profiles as p
      on p.id = auth.uid()
    where c.id = target_case_id
      and p.tenant_id = c.tenant_id
      and p.role = 'support_agent'::public.app_role
  );
$$;

revoke all on function private.is_current_user_customer_for_tenant(uuid) from public;
revoke all on function private.is_support_agent_for_tenant(uuid) from public;
revoke all on function private.is_current_user_customer_for_case(uuid) from public;
revoke all on function private.is_support_agent_for_case(uuid) from public;

grant execute on function private.is_current_user_customer_for_tenant(uuid) to authenticated;
grant execute on function private.is_support_agent_for_tenant(uuid) to authenticated;
grant execute on function private.is_current_user_customer_for_case(uuid) to authenticated;
grant execute on function private.is_support_agent_for_case(uuid) to authenticated;

create or replace function public.prevent_case_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.customer_id is distinct from old.customer_id then
    raise exception 'tenant_id and customer_id cannot be changed after case creation';
  end if;

  return new;
end;
$$;

create trigger support_cases_prevent_identity_change
before update on public.support_cases
for each row execute function public.prevent_case_identity_change();

alter table public.profiles enable row level security;
alter table public.support_cases enable row level security;
alter table public.case_updates enable row level security;

create policy "profiles: user can read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy "support cases: customer can read own cases"
on public.support_cases
for select
to authenticated
using (
  customer_id = auth.uid()
  and private.is_current_user_customer_for_tenant(tenant_id)
);

create policy "support cases: agent can read tenant cases"
on public.support_cases
for select
to authenticated
using (private.is_support_agent_for_tenant(tenant_id));

create policy "support cases: customer can create own case"
on public.support_cases
for insert
to authenticated
with check (
  customer_id = auth.uid()
  and private.is_current_user_customer_for_tenant(tenant_id)
);

create policy "support cases: agent can update tenant cases"
on public.support_cases
for update
to authenticated
using (private.is_support_agent_for_tenant(tenant_id))
with check (private.is_support_agent_for_tenant(tenant_id));

create policy "case updates: customer can read public updates on own cases"
on public.case_updates
for select
to authenticated
using (
  not is_internal
  and private.is_current_user_customer_for_case(case_id)
);

create policy "case updates: agent can read tenant case updates"
on public.case_updates
for select
to authenticated
using (private.is_support_agent_for_case(case_id));

create policy "case updates: customer can add public messages to own cases"
on public.case_updates
for insert
to authenticated
with check (
  author_id = auth.uid()
  and not is_internal
  and previous_status is null
  and new_status is null
  and private.is_current_user_customer_for_case(case_id)
);

create policy "case updates: agent can add tenant case updates"
on public.case_updates
for insert
to authenticated
with check (
  author_id = auth.uid()
  and private.is_support_agent_for_case(case_id)
);