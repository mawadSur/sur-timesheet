-- ============================================================================
--  MIGRATION: 20260714120000_crm_expenses
--
--  WHAT THIS DOES
--    Adds PHASE 9 to the live database: the lightweight CRM (pipeline) fields on
--    public.projects and the per-project public.expenses ledger. Copied verbatim
--    from supabase/schema.sql (the source of truth).
--
--  IDEMPOTENT & SAFE ON AN EXISTING DB
--    Every statement is create table / add column IF NOT EXISTS, drop constraint
--    if exists + add, or drop policy if exists + create — safe to re-run.
--
--  ENDS WITH A SCHEMA-CACHE RELOAD
--    PostgREST serves reads/writes from an in-memory schema cache. New columns /
--    tables are invisible to the API until it reloads, which is why prior billing
--    migrations failed with PGRST205 "not found in the schema cache". The closing
--    `NOTIFY pgrst, 'reload schema'` forces an immediate reload so saving an
--    expense / opportunity works right after this migration runs.
-- ============================================================================

-- ── CRM fields on projects (nullable, additive) ─────────────────────────────
alter table public.projects add column if not exists pipeline_stage        text;
alter table public.projects add column if not exists contact_name          text;
alter table public.projects add column if not exists contact_email         text;
alter table public.projects add column if not exists source                text;
alter table public.projects add column if not exists next_step             text;
alter table public.projects add column if not exists next_step_on          date;
alter table public.projects add column if not exists estimated_value_cents bigint;

alter table public.projects drop constraint if exists projects_pipeline_stage_check;
alter table public.projects add  constraint projects_pipeline_stage_check
  check (pipeline_stage is null or pipeline_stage in ('Lead','Qualified','Proposal','Won','Lost'));

-- ── Per-project expense ledger (admin-only) ─────────────────────────────────
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  spent_on     date not null,
  amount_cents bigint not null check (amount_cents >= 0),
  category     text,
  vendor       text,
  description  text,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists expenses_project_spent_idx
  on public.expenses (project_id, spent_on desc);

alter table public.expenses enable row level security;
drop policy if exists expenses_admin on public.expenses;
create policy expenses_admin on public.expenses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Force PostgREST to pick up the new columns/table immediately ────────────
notify pgrst, 'reload schema';
