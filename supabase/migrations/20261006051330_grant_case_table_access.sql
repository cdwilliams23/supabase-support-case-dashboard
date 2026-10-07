grant usage on schema public to authenticated, service_role;

grant select on public.profiles to authenticated;

grant select, insert, update on public.support_cases to authenticated;

grant select, insert on public.case_updates to authenticated;

grant all privileges on public.profiles to service_role;
grant all privileges on public.support_cases to service_role;
grant all privileges on public.case_updates to service_role;