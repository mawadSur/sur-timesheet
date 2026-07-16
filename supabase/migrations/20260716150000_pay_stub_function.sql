-- ============================================================================
--  SELF-SERVE PAY STUBS — 2026-07-16
--
--  payroll_runs / payroll_run_lines are admin-only via RLS: the run header
--  carries total_cents (the company-wide payroll total), so there is NO
--  contractor-facing SELECT policy on those tables (exposing the header to a
--  contractor would leak the total). This function is the deliberate,
--  column-scoped follow-up: it lets each signed-in person read ONLY their own
--  PAID line rows plus SAFE run fields (period + paid_on) — never total_cents,
--  never another user's rows.
--
--  SECURITY DEFINER runs with the owner's rights (past the admin-only RLS), and
--  the internal `prl.user_id = auth.uid()` predicate is what scopes the result
--  to the caller's own paid lines. The returns-table signature deliberately
--  omits total_cents so it can never be selected through this path.
--
--  Idempotent & additive. Safe to re-run.
-- ============================================================================
create or replace function public.my_pay_stubs()
returns table (
  run_id       uuid,
  period_start date,
  period_end   date,
  paid_on      date,
  project_name text,
  hours        numeric,
  pay_rate     numeric,
  amount_cents bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select pr.id, pr.period_start, pr.period_end, pr.paid_on,
         prl.project_name, prl.hours, prl.pay_rate, prl.amount_cents
  from public.payroll_run_lines prl
  join public.payroll_runs pr on pr.id = prl.run_id
  where prl.user_id = auth.uid() and pr.status = 'paid'
  order by pr.period_start desc, prl.amount_cents desc;
$$;

notify pgrst, 'reload schema';
