-- ============================================================================
--  PAYROLL RUNS — 2026-07-16
--
--  A finalizable system-of-record for contractor payouts. The /admin/payroll
--  calculator is a LIVE view; a payroll run FREEZES a pay period's breakdown
--  (one line per contractor × project) into an immutable record that can be
--  marked paid and later voided — mirroring the invoice lifecycle. Draft runs
--  can be regenerated from live data or deleted; paid runs are the record of
--  what was actually paid. Admin-only (like invoices / rates / expenses).
--
--  Idempotent & additive. Safe to re-run.
-- ============================================================================

-- One run per pay period. total_cents is the frozen sum of its line amounts.
create table if not exists public.payroll_runs (
  id           uuid primary key default gen_random_uuid(),
  period_key   text not null unique,
  period_start date not null,
  period_end   date not null,
  status       text not null default 'draft' check (status in ('draft','paid','void')),
  total_cents  bigint not null default 0,
  paid_on      date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Frozen breakdown lines: one per (contractor × project) in the run.
create table if not exists public.payroll_run_lines (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.payroll_runs(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete restrict,
  user_name    text,
  project_id   uuid,
  project_name text,
  hours        numeric(10,2) not null default 0,
  pay_rate     numeric(10,2),
  amount_cents bigint not null default 0,
  created_at   timestamptz not null default now()
);

alter table public.payroll_runs      enable row level security;
alter table public.payroll_run_lines enable row level security;

-- Admins manage everything.
drop policy if exists payroll_runs_admin on public.payroll_runs;
create policy payroll_runs_admin on public.payroll_runs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admin-only for now. The run header carries total_cents (the company-wide
-- payroll total), so there is NO contractor-facing SELECT — a self-serve pay
-- stub is a deliberate follow-up that needs a column-scoped view, not a row
-- policy. The drops keep this idempotent and remove the earlier leaky policies
-- if they were ever created.
drop policy if exists payroll_runs_own_paid on public.payroll_runs;

drop policy if exists payroll_run_lines_admin on public.payroll_run_lines;
create policy payroll_run_lines_admin on public.payroll_run_lines
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists payroll_run_lines_own_paid on public.payroll_run_lines;

notify pgrst, 'reload schema';
