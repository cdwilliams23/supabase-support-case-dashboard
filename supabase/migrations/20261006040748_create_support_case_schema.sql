create type public.app_role as enum ('customer', 'support_agent');

create type public.case_status as enum (
  'open',
  'in_progress',
  'waiting_on_customer',
  'resolved',
  'closed'
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  tenant_id uuid not null,
  role public.app_role not null default 'customer',
  display_name text not null check (char_length(btrim(display_name)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is
  'Application profile and tenant/role assignment for an authenticated user.';

create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid not null references public.profiles (id) on delete restrict,
  subject text not null check (char_length(btrim(subject)) between 1 and 160),
  description text not null check (char_length(btrim(description)) > 0),
  status public.case_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.support_cases is
  'Customer support cases. tenant_id preserves the authorization boundary at case creation time.';

create table public.case_updates (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.support_cases (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete restrict,
  body text check (body is null or char_length(btrim(body)) > 0),
  previous_status public.case_status,
  new_status public.case_status,
  is_internal boolean not null default false,
  created_at timestamptz not null default now(),
  check (body is not null or new_status is not null)
);

comment on table public.case_updates is
  'Case timeline entries, including messages and status transitions.';

create index profiles_tenant_role_idx
  on public.profiles (tenant_id, role);

create index support_cases_customer_created_at_idx
  on public.support_cases (customer_id, created_at desc);

create index support_cases_tenant_status_updated_at_idx
  on public.support_cases (tenant_id, status, updated_at desc);

create index case_updates_case_created_at_idx
  on public.case_updates (case_id, created_at);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger support_cases_set_updated_at
before update on public.support_cases
for each row execute function public.set_updated_at();