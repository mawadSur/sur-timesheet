-- ============================================================================
--  LOCK HOURS ONCE PAID — 2026-07-16
--
--  Product rule: a timesheet row becomes read-only for the EMPLOYEE (they can
--  no longer DELETE — nor UPDATE, though no owner UPDATE policy exists today —
--  their own row) once it has been PAID. "Paid" means the row's work_date falls
--  inside a PAID invoice's period for its project, OR inside a PAID payroll
--  run's period where that user has a run line. Admins keep full control
--  (override) and INSERT / SELECT are unchanged.
--
--  Idempotent & additive. Safe to re-run.
-- ============================================================================

-- Is this (user, project, date) already covered by a paid invoice or paid
-- payroll run? Security definer so the check runs regardless of the caller's
-- own RLS visibility into invoices / payroll_runs.
create or replace function public.timesheet_is_locked(ts_user uuid, ts_project uuid, ts_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Only answer truthfully for the caller's own rows (or an admin). A non-admin
  -- probing another user's (project, date) gets false, so this SECURITY DEFINER
  -- function can't be used as an oracle over who has paid invoices / payroll runs.
  -- In the RLS owner-delete policy ts_user is always the caller's own user_id, so
  -- lock enforcement is unaffected.
  select (public.is_admin() or ts_user = auth.uid()) and (
    exists (
      select 1 from public.invoices i
      where i.project_id = ts_project and i.status = 'paid'
        and ts_date between i.period_start and i.period_end
    ) or exists (
      select 1 from public.payroll_runs pr
      join public.payroll_run_lines prl on prl.run_id = pr.id
      where pr.status = 'paid' and prl.user_id = ts_user
        and ts_date between pr.period_start and pr.period_end
    )
  );
$$;

-- Recreate the OWNER delete policy, adding the paid-lock to the employee branch
-- only. Admins still delete anything; active owners can delete their own rows
-- ONLY while those rows are not yet paid-locked.
-- (There is no owner UPDATE policy — employees cannot UPDATE their own rows at
--  all — so only the DELETE policy needs the lock. INSERT / SELECT unchanged.)
drop policy if exists timesheets_modify on public.timesheets;
create policy timesheets_modify on public.timesheets
  for delete to authenticated using (
    public.is_admin() or (
      public.is_active_user() and user_id = auth.uid()
      and not public.timesheet_is_locked(user_id, project_id, work_date)
    )
  );

notify pgrst, 'reload schema';
