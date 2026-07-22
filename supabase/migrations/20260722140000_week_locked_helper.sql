-- ============================================================================
--  my_week_locked(week_start) — can the caller still change this week?
--
--  The weekly grid lets someone fix a mistake in the CURRENT week by replacing
--  what they submitted (delete + re-insert). That must stop the moment the
--  hours have been paid, so this answers "is any of my time in this week
--  already locked by a paid invoice or a paid payroll run?" in one round trip
--  instead of one probe per (project, day).
--
--  security definer + an internal `user_id = auth.uid()` predicate: it only
--  ever reports on the caller's OWN rows, so it can't be used as an oracle over
--  who has paid invoices. Delegates the actual rule to timesheet_is_locked() so
--  there is exactly one definition of "paid" (it is also what the RLS delete
--  policy enforces — this function is the friendly pre-check, not the guard).
--
--  Idempotent.
-- ============================================================================
create or replace function public.my_week_locked(week_start date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.timesheets t
    where t.user_id = auth.uid()
      and t.work_date between week_start and week_start + 6
      and public.timesheet_is_locked(t.user_id, t.project_id, t.work_date)
  );
$$;

notify pgrst, 'reload schema';
