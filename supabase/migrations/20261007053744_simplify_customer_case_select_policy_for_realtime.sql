drop policy "support cases: customer can read own cases"
on public.support_cases;

create policy "support cases: customer can read own cases"
on public.support_cases
for select
to authenticated
using (customer_id = auth.uid());