-- ============================================================================
--  Fix: "Could not find the table 'public.assignment_rates' in the schema cache"
--
--  Root cause: PostgREST serves reads/writes from an in-memory schema cache. The
--  billing/M2/feedback tables were created by an earlier migration, but
--  PostgREST's cache was never reloaded, so every request against those tables
--  (saving a bill/pay rate, listing invoices, Books, feedback) fails with
--  PGRST205 "not found in the schema cache" even though the tables exist.
--
--  This migration:
--    1. Re-asserts the phase 4-8 objects idempotently, so anything genuinely
--       missing (or partially applied) is created. All statements are
--       IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS + recreate, so
--       re-running against an up-to-date DB is a harmless no-op. Copied verbatim
--       from supabase/schema.sql (the source of truth).
--    2. Ends with `NOTIFY pgrst, 'reload schema'` to force PostgREST to reload
--       its schema cache immediately — the actual fix for the reported error.
--       This reloads the cache for the ENTIRE public schema, not just these
--       tables, so it also unblocks invoices, invoice_lines, rescuetime_rules,
--       and feedback if they were stale too.
-- ============================================================================

-- ── PHASE 4 — billing & books (M1: rates + margin) ──────────────────────────
create table if not exists public.assignment_rates (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  bill_rate  numeric(10,2),
  pay_rate   numeric(10,2),
  updated_at timestamptz not null default now()
);

-- Defensive: if the table pre-existed with drifted columns, ensure the columns
-- the app writes to (bill_rate, pay_rate, updated_at) exist.
alter table public.assignment_rates add column if not exists bill_rate  numeric(10,2);
alter table public.assignment_rates add column if not exists pay_rate   numeric(10,2);
alter table public.assignment_rates add column if not exists updated_at timestamptz not null default now();

alter table public.assignment_rates enable row level security;
drop policy if exists assignment_rates_admin on public.assignment_rates;
create policy assignment_rates_admin on public.assignment_rates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

alter table public.projects add column if not exists bill_to text;
alter table public.projects add column if not exists payment_terms_days integer not null default 30;

-- ── PHASE 5 — M2: client invoices + AR aging ────────────────────────────────
create table if not exists public.invoices (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.projects(id) on delete restrict,
  invoice_number        text unique,
  period_start          date not null,
  period_end            date not null,
  status                text not null default 'draft' check (status in ('draft','sent','paid','void')),
  issued_on             date,
  due_on                date,
  paid_on               date,
  subtotal_cents        bigint not null default 0,
  adjustment_cents      bigint not null default 0,
  total_cents           bigint not null default 0,
  amount_received_cents bigint not null default 0,
  bill_to               text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (project_id, period_start, period_end)
);

create table if not exists public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  user_id      uuid references public.profiles(id) on delete set null,
  description  text not null,
  hours        numeric(8,2) not null,
  bill_rate    numeric(10,2) not null,
  amount_cents bigint not null
);

alter table public.invoices      enable row level security;
alter table public.invoice_lines enable row level security;
drop policy if exists invoices_admin on public.invoices;
create policy invoices_admin on public.invoices
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists invoice_lines_admin on public.invoice_lines;
create policy invoice_lines_admin on public.invoice_lines
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create sequence if not exists public.invoice_seq;
create or replace function public.next_invoice_number()
returns text
language sql
security definer
set search_path = public
as $$
  select 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_seq')::text, 4, '0');
$$;

-- ── PHASE 6 — "Staff" role ──────────────────────────────────────────────────
alter table public.profiles       drop constraint if exists profiles_role_check;
alter table public.profiles       add  constraint profiles_role_check       check (role in ('employee','staff','admin'));
alter table public.allowed_emails drop constraint if exists allowed_emails_role_check;
alter table public.allowed_emails add  constraint allowed_emails_role_check check (role in ('employee','staff','admin'));

create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'staff'
  );
$$;

drop policy if exists credentials_select on public.credentials;
create policy credentials_select on public.credentials
  for select to authenticated using (
    public.is_admin() or (
      not public.is_staff() and exists (
        select 1 from public.assignments a
        where a.project_id = credentials.project_id and a.user_id = auth.uid()
      )
    )
  );

-- ── PHASE 7 — RescueTime bridge ─────────────────────────────────────────────
create table if not exists public.rescuetime_rules (
  id         uuid primary key default gen_random_uuid(),
  keyword    text not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.rescuetime_rules enable row level security;
drop policy if exists rescuetime_rules_admin on public.rescuetime_rules;
create policy rescuetime_rules_admin on public.rescuetime_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── PHASE 8 — continuous feedback + Discord identity ────────────────────────
alter table public.profiles add column if not exists discord_user_id text;

create table if not exists public.feedback (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  subject_profile_id uuid references public.profiles(id) on delete set null,
  author_id          uuid references public.profiles(id) on delete set null,
  body               text not null,
  created_at         timestamptz not null default now()
);

create index if not exists feedback_project_created_idx
  on public.feedback (project_id, created_at desc);

alter table public.feedback enable row level security;
drop policy if exists feedback_admin on public.feedback;
create policy feedback_admin on public.feedback
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists feedback_subject_select on public.feedback;
create policy feedback_subject_select on public.feedback
  for select to authenticated using (subject_profile_id = auth.uid());

-- ── The actual fix: force PostgREST to reload its schema cache ───────────────
-- Without this, PostgREST keeps serving a stale cache and returns
-- PGRST205 "Could not find the table ... in the schema cache" for tables that
-- already exist in Postgres.
notify pgrst, 'reload schema';
