-- ============================================================================
--  EFFECTIVE-DATED ASSIGNMENT RATES — 2026-07-16
--
--  A rate now carries an `effective_from` date and there may be a HISTORY of
--  rows per assignment. An hour worked on `work_date` is priced at the rate
--  whose effective_from is the latest one on or before that work_date. Changing
--  a rate today therefore prices tomorrow's hours at the new rate while leaving
--  every already-worked hour at the rate that was in effect when it happened —
--  Books, payroll, and draft invoices all stop retroactively repricing the past.
--
--  Backfill: existing single rows become effective from the epoch so ALL past
--  hours keep pricing exactly as they do today (one rate applied to everything).
--  New rates default to effective_from = current_date (today forward).
--
--  Idempotent & data-preserving. Safe to re-run.
-- ============================================================================

alter table public.assignment_rates add column if not exists effective_from date;

-- Existing rows predate any dated history: make them cover all past hours.
update public.assignment_rates set effective_from = date '1970-01-01' where effective_from is null;

alter table public.assignment_rates alter column effective_from set not null;
alter table public.assignment_rates alter column effective_from set default current_date;

-- Re-key: one row per (assignment, effective_from) instead of one per assignment.
-- (The assignment_id foreign key to public.assignments is a separate constraint
-- and is left untouched.)
alter table public.assignment_rates drop constraint if exists assignment_rates_pkey;
alter table public.assignment_rates add constraint assignment_rates_pkey
  primary key (assignment_id, effective_from);

notify pgrst, 'reload schema';
