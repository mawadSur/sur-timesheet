-- ============================================================================
--  SUR PORTAL — Phase 1 schema
--  Paste this whole file into the Supabase SQL Editor and run it once.
--  Safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS).
-- ============================================================================

-- ── Tables ──────────────────────────────────────────────────────────────────

-- Who is allowed to sign in, and with what role. The admin manages this list.
create table if not exists public.allowed_emails (
  email      text primary key,
  role       text not null default 'employee' check (role in ('employee','admin')),
  created_at timestamptz not null default now()
);

-- One row per authenticated user (created automatically on first sign-in).
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null default 'employee' check (role in ('employee','admin')),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

-- Projects. vm_host / pikvm_host / tailscale_tag are used by later phases;
-- harmless to keep now (vm_host is just a link, not a secret).
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  starts_on     date,
  ends_on       date,
  vm_host       text,
  pikvm_host    text,
  tailscale_tag text,
  created_at    timestamptz not null default now()
);

-- Which person is assigned to which project (many-to-many).
create table if not exists public.assignments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  project_id  uuid not null references public.projects(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  unique (user_id, project_id)
);

-- Logged hours. One row per project per submission.
create table if not exists public.timesheets (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  work_date  date not null,
  hours      numeric(5,2) not null check (hours > 0 and hours <= 24),
  notes      text,
  created_at timestamptz not null default now()
);

-- ── Helper: am I an admin? (security definer avoids RLS recursion) ────────────
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin' and coalesce(is_active, true)
  );
$$;

-- ── Helper: am I an active (non-revoked) user? ────────────────────────────────
-- A user with is_active = false gets NO data even with a still-valid JWT; NULL
-- is treated as active (mirrors the middleware). Gates employee/staff branches.
create or replace function public.is_active_user()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and coalesce(is_active, true)
  );
$$;

-- ── Row Level Security ────────────────────────────────────────────────────────
alter table public.allowed_emails enable row level security;
alter table public.profiles       enable row level security;
alter table public.projects       enable row level security;
alter table public.assignments    enable row level security;
alter table public.timesheets     enable row level security;

-- allowed_emails: admin only
drop policy if exists allowed_emails_admin on public.allowed_emails;
create policy allowed_emails_admin on public.allowed_emails
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- profiles: see own or (admin) all; admin can update roles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- projects: admin sees all & manages; employees see only assigned projects
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated using (
    public.is_admin() or (public.is_active_user() and exists (
      select 1 from public.assignments a
      where a.project_id = projects.id and a.user_id = auth.uid()
    ))
  );
drop policy if exists projects_write_admin on public.projects;
create policy projects_write_admin on public.projects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- assignments: employees see own; admin manages all
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated using (public.is_admin() or (public.is_active_user() and user_id = auth.uid()));
drop policy if exists assignments_write_admin on public.assignments;
create policy assignments_write_admin on public.assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- timesheets: employees see/insert own (only for assigned projects); admin sees all
drop policy if exists timesheets_select on public.timesheets;
create policy timesheets_select on public.timesheets
  for select to authenticated using (public.is_admin() or (public.is_active_user() and user_id = auth.uid()));
drop policy if exists timesheets_insert on public.timesheets;
create policy timesheets_insert on public.timesheets
  for insert to authenticated with check (
    user_id = auth.uid() and public.is_active_user() and exists (
      select 1 from public.assignments a
      where a.user_id = auth.uid() and a.project_id = timesheets.project_id
    )
  );
-- NOTE: timesheets_modify (owner DELETE) is re-created near the end of this
-- file to add the paid-lock (see "LOCK HOURS ONCE PAID"). It is defined here
-- too so the ordering is clear; the later drop/recreate wins.
drop policy if exists timesheets_modify on public.timesheets;
create policy timesheets_modify on public.timesheets
  for delete to authenticated using (public.is_admin() or (public.is_active_user() and user_id = auth.uid()));

-- ── Seed the first admin ──────────────────────────────────────────────────────
-- IMPORTANT: change this to YOUR Google email before running, if different.
insert into public.allowed_emails (email, role)
values ('mawad10101@gmail.com', 'admin')
on conflict (email) do update set role = 'admin';

-- ============================================================================
--  PHASE 2 — credentials vault, audit log, access revocation
--  Idempotent; safe to run on top of the Phase 1 schema above.
-- ============================================================================

-- ── Access revocation flags ──────────────────────────────────────────────────
alter table public.profiles       add column if not exists is_active boolean not null default true;
alter table public.allowed_emails add column if not exists is_active boolean not null default true;

-- ── On sign-in: enforce the allowlist (incl. revoked accounts) and create the profile ──
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_role text;
  allowed_active boolean;
begin
  select role, is_active into allowed_role, allowed_active
  from public.allowed_emails
  where lower(email) = lower(new.email);

  if allowed_role is null then
    raise exception 'Email % is not authorized for the Sur Portal', new.email;
  end if;
  if allowed_active is false then
    raise exception 'Access for % has been revoked', new.email;
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    allowed_role
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Credentials vault ──────────────────────────────────────────────────────────
-- secret_encrypted holds AES-256-GCM ciphertext produced by the app (lib/crypto.ts).
-- The DB never sees plaintext secrets.
create table if not exists public.credentials (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  label            text not null,
  username         text,
  secret_encrypted text not null,
  url              text,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.credentials enable row level security;
-- Assigned users may read their projects' credential rows (ciphertext only;
-- decryption happens server-side). Admin manages everything.
drop policy if exists credentials_select on public.credentials;
create policy credentials_select on public.credentials
  for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.assignments a
      where a.project_id = credentials.project_id and a.user_id = auth.uid()
    )
  );
drop policy if exists credentials_write_admin on public.credentials;
create policy credentials_write_admin on public.credentials
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── Audit log ────────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id) on delete set null,
  actor_email text,
  action      text not null,
  target      text,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

alter table public.audit_log enable row level security;
drop policy if exists audit_select_admin on public.audit_log;
create policy audit_select_admin on public.audit_log
  for select to authenticated using (public.is_admin());
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert to authenticated with check (actor_id = auth.uid());

-- ============================================================================
--  PHASE 3 — admin project dashboard: project metadata, time off, Discord status
--  Idempotent.
-- ============================================================================

-- Project metadata for the admin dashboard.
alter table public.projects add column if not exists status text not null default 'Active';
alter table public.projects add column if not exists pay_type text;           -- 'C2C' | 'W2' | '1099'
alter table public.projects add column if not exists manager_name text;
alter table public.projects add column if not exists it_support_phone text;
alter table public.projects add column if not exists recruiter_email text;
alter table public.projects add column if not exists discord_channel_id text;
alter table public.projects add column if not exists discord_status_summary text;
alter table public.projects add column if not exists discord_status_raw text;
alter table public.projects add column if not exists discord_status_updated_at timestamptz;

-- Planned days off, scoped to a project (optionally attributed to a person).
create table if not exists public.time_off (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  user_id     uuid references public.profiles(id) on delete set null,
  person_name text,
  start_date  date not null,
  end_date    date not null,
  note        text,
  created_at  timestamptz not null default now()
);

alter table public.time_off enable row level security;
drop policy if exists time_off_select on public.time_off;
create policy time_off_select on public.time_off
  for select to authenticated using (public.is_admin());
drop policy if exists time_off_write_admin on public.time_off;
create policy time_off_write_admin on public.time_off
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
--  PHASE 4 — billing & books (M1: rates + margin)
--  Idempotent. Additive + admin-only. Employee flows are untouched.
-- ============================================================================

-- Per-assignment rates. Deliberately a SEPARATE, admin-only table (not columns
-- on `assignments`) so bill/pay rates NEVER appear on employee-readable
-- assignment rows. Money lives only where is_admin() can reach it.
create table if not exists public.assignment_rates (
  assignment_id  uuid not null references public.assignments(id) on delete cascade,
  effective_from date not null default current_date, -- rate applies to hours on/after this date
  bill_rate  numeric(10,2),   -- what the client pays per hour (revenue side)
  pay_rate   numeric(10,2),   -- what we pay the consultant per hour (cost side)
  updated_at timestamptz not null default now(),
  -- Effective-dated history: several rows per assignment; an hour prices at the
  -- row with the latest effective_from on or before its work_date.
  primary key (assignment_id, effective_from)
);

alter table public.assignment_rates enable row level security;
drop policy if exists assignment_rates_admin on public.assignment_rates;
create policy assignment_rates_admin on public.assignment_rates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Per-project billing defaults (who we bill, net-N terms). Deliberately NOT
-- columns on `projects`: staff can read every project row, so this lives in an
-- admin-only table alongside the rest of the money layer. See PHASE 10.
create table if not exists public.project_billing (
  project_id         uuid primary key references public.projects(id) on delete cascade,
  bill_to            text,
  payment_terms_days integer not null default 30,
  updated_at         timestamptz not null default now()
);

alter table public.project_billing enable row level security;
drop policy if exists project_billing_admin on public.project_billing;
create policy project_billing_admin on public.project_billing
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ============================================================================
--  PHASE 5 — M2: client invoices + AR aging
--  Idempotent. Additive + admin-only.
-- ============================================================================

-- One invoice per project per period (month). invoice_number is assigned when
-- the invoice is sent (draft invoices have no number yet). Money is stored in
-- integer cents as a snapshot frozen at send time.
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

-- Snapshot line items, frozen when the invoice is sent (one per consultant).
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

-- Sequential invoice numbers: INV-YYYY-0001. The sequence guarantees no race.
create sequence if not exists public.invoice_seq;
create or replace function public.next_invoice_number()
returns text
language sql
security definer
set search_path = public
as $$
  select 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_seq')::text, 4, '0');
$$;

-- ============================================================================
--  PAYROLL RUNS — finalizable contractor payouts (system of record)
--  Idempotent. Mirrors the invoice lifecycle: a run FREEZES a pay period's
--  breakdown (one line per contractor × project) so it can be marked paid and
--  later voided. Draft runs regenerate from live data or are deleted.
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

drop policy if exists payroll_runs_admin on public.payroll_runs;
create policy payroll_runs_admin on public.payroll_runs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Admin-only. The run header carries total_cents (company-wide payroll total),
-- so there is NO contractor-facing SELECT; a self-serve pay stub is a follow-up
-- that needs a column-scoped view. Drops remove the earlier leaky policies.
drop policy if exists payroll_runs_own_paid on public.payroll_runs;

drop policy if exists payroll_run_lines_admin on public.payroll_run_lines;
create policy payroll_run_lines_admin on public.payroll_run_lines
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists payroll_run_lines_own_paid on public.payroll_run_lines;

-- ============================================================================
--  PHASE 6 — "Staff" role: a restricted support type
--  Staff log hours like employees but are blocked from project credentials.
--  Idempotent.
-- ============================================================================

-- Allow the new role value on both tables (drop + re-add the inline check).
alter table public.profiles       drop constraint if exists profiles_role_check;
alter table public.profiles       add  constraint profiles_role_check       check (role in ('employee','staff','admin'));
alter table public.allowed_emails drop constraint if exists allowed_emails_role_check;
alter table public.allowed_emails add  constraint allowed_emails_role_check check (role in ('employee','staff','admin'));

-- Helper mirroring is_admin(): am I a staff member? (security definer avoids recursion)
create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'staff' and coalesce(is_active, true)
  );
$$;

-- Credentials: admin sees all; assigned NON-staff users see their projects'.
-- Staff are blocked from the vault even on projects they're assigned to.
drop policy if exists credentials_select on public.credentials;
create policy credentials_select on public.credentials
  for select to authenticated using (
    public.is_admin() or (
      public.is_active_user() and not public.is_staff() and exists (
        select 1 from public.assignments a
        where a.project_id = credentials.project_id and a.user_id = auth.uid()
      )
    )
  );

-- ============================================================================
--  PHASE 7 — RescueTime bridge: window-title keyword -> project rules
--  The RescueTime API tracks time by app/site/window title, not by project, so
--  these rules map title keywords to projects to suggest per-project hours.
--  Admin-only. The RescueTime API key itself lives in the RESCUETIME_API_KEY
--  env var (server-only), not the DB. Idempotent.
-- ============================================================================
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

-- ============================================================================
--  PHASE 8 — continuous feedback + Discord identity
--  Idempotent. Additive. Admin-authored; a subject may read their own feedback.
-- ============================================================================

-- Optional Discord user id per person, used by the provisioning lane to map a
-- profile to a Discord account. Nullable; not a secret.
alter table public.profiles add column if not exists discord_user_id text;

-- Continuous feedback: an admin-authored note on a project, optionally about a
-- specific person (subject). A null subject_profile_id is a project-level note.
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
-- Admins manage everything; a subject may read feedback written about them.
-- Non-admins get no insert/update/delete.
drop policy if exists feedback_admin on public.feedback;
create policy feedback_admin on public.feedback
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists feedback_subject_select on public.feedback;
create policy feedback_subject_select on public.feedback
  for select to authenticated using (public.is_active_user() and subject_profile_id = auth.uid());

-- ============================================================================
--  PHASE 9 — lightweight CRM (pipeline) + per-project expense ledger
--  Idempotent. Additive. Admin-only money; employee flows are untouched.
--
--  CRM re-uses the existing `projects` model rather than a separate app: an
--  incoming candidate is a project with a matching admin-only `project_crm` row.
--  Once the candidate starts it keeps flowing through the same assignment /
--  timesheet / books lifecycle. The operational `status` (Active / On Hold / …) stays
--  separate from the recruiting `pipeline_stage` (Offer / Background check /
--  Expected start) so a project can be both.
-- ============================================================================

-- CRM / recruiting-pipeline fields live in their OWN admin-only table, NOT on
-- projects: projects_select is row-level (an assigned non-admin employee can read
-- their project's whole row via the REST API), so candidate PII + hourly rate must
-- sit behind is_admin() — the same pattern as assignment_rates / expenses /
-- invoices. `pay_type` (employment type) stays on projects as operational,
-- non-sensitive metadata.
create table if not exists public.project_crm (
  project_id            uuid primary key references public.projects(id) on delete cascade,
  pipeline_stage        text check (pipeline_stage is null or pipeline_stage in ('Offer','Background check','Expected start')),
  contact_name          text,
  contact_email         text,
  contact_phone         text,   -- point-of-contact phone
  source                text,   -- (legacy: where the lead came from — no longer surfaced)
  next_step             text,   -- next action to move it forward
  next_step_on          date,   -- when that next action is due
  estimated_value_cents bigint, -- candidate hourly rate (integer cents)
  updated_at            timestamptz not null default now()
);

alter table public.project_crm enable row level security;
drop policy if exists project_crm_admin on public.project_crm;
create policy project_crm_admin on public.project_crm
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Per-project expense ledger. Admin-only, like invoices / assignment_rates —
-- cost/money lives only where is_admin() can reach it. amount_cents is a
-- non-negative integer (cents) to match the money layer.
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

-- ============================================================================
--  LOCK HOURS ONCE PAID
--
--  A timesheet row becomes read-only for the EMPLOYEE (they can no longer
--  DELETE — nor UPDATE, though no owner UPDATE policy exists — their own row)
--  once it has been PAID: its work_date falls inside a PAID invoice's period
--  for its project, OR inside a PAID payroll run's period where that user has a
--  run line. Admins keep full control; INSERT / SELECT are unchanged.
--
--  Defined here (not next to the timesheets policies above) because the
--  function body reads public.invoices / public.payroll_runs, which must exist
--  first. This drop/recreate of timesheets_modify supersedes the plain owner
--  DELETE policy defined earlier so a fresh build ends locked.
-- ============================================================================
create or replace function public.timesheet_is_locked(ts_user uuid, ts_project uuid, ts_date date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Only answer truthfully for the caller's own rows (or an admin), so this
  -- SECURITY DEFINER function can't be probed as an oracle over who has paid
  -- invoices / payroll runs. In the RLS owner-delete policy ts_user is always the
  -- caller's own user_id, so lock enforcement is unaffected.
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

drop policy if exists timesheets_modify on public.timesheets;
create policy timesheets_modify on public.timesheets
  for delete to authenticated using (
    public.is_admin() or (
      public.is_active_user() and user_id = auth.uid()
      and not public.timesheet_is_locked(user_id, project_id, work_date)
    )
  );

-- ============================================================================
--  SELF-SERVE PAY STUBS
--
--  payroll_runs / payroll_run_lines (defined earlier) are admin-only via RLS —
--  the run header's total_cents is the company-wide payroll total, so there is
--  no contractor-facing SELECT policy. This SECURITY DEFINER function is the
--  column-scoped follow-up: each signed-in person reads ONLY their own PAID
--  line rows plus safe run fields (period + paid_on), never total_cents, never
--  another user's rows. The internal `prl.user_id = auth.uid()` predicate does
--  the scoping. Defined at end-of-file so payroll_runs / payroll_run_lines
--  already exist (avoids a forward reference).
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

-- ============================================================================
--  PHASE 10 — Staff: every project, no money
--
--  Staff are a restricted support type who float across the whole portfolio, so
--  they read EVERY project and may log hours against any of it — while staying
--  locked out of the credentials vault (Phase 6) and of every money table
--  (assignment_rates / invoices / payroll_* / project_crm / expenses /
--  project_billing are all is_admin()-only, and /admin is admin-gated in
--  middleware). Their own pay stubs still work: my_pay_stubs() is scoped to the
--  caller's own paid lines.
--
--  Redefined here (not above) because both policies reference is_staff(), which
--  is created in the Phase 6 block. Same define-early / widen-later pattern as
--  credentials_select. Idempotent.
-- ============================================================================

-- projects: admin sees all; staff see all; employees see their assigned ones.
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated using (
    public.is_admin() or (
      public.is_active_user() and (
        public.is_staff() or exists (
          select 1 from public.assignments a
          where a.project_id = projects.id and a.user_id = auth.uid()
        )
      )
    )
  );

-- timesheets: employees insert only for assigned projects; staff for any.
drop policy if exists timesheets_insert on public.timesheets;
create policy timesheets_insert on public.timesheets
  for insert to authenticated with check (
    user_id = auth.uid() and public.is_active_user() and (
      public.is_staff() or exists (
        select 1 from public.assignments a
        where a.user_id = auth.uid() and a.project_id = timesheets.project_id
      )
    )
  );

-- ============================================================================
--  EDIT THE CURRENT WEEK UNTIL IT IS PAID
--
--  The weekly grid lets someone fix a mistake in the CURRENT week by replacing
--  what they submitted (delete + re-insert); past weeks stay read-only. That
--  editing window has to close once the hours have been paid, so this answers
--  "is any of my time in this week already locked by a paid invoice or a paid
--  payroll run?" in one round trip rather than one probe per (project, day).
--
--  Defined at end-of-file because it delegates to timesheet_is_locked(), which
--  itself reads invoices / payroll_runs. security definer + an internal
--  `user_id = auth.uid()` predicate keeps it scoped to the caller's own rows,
--  so it can't be probed as an oracle over who has been paid. The real guard is
--  still the RLS delete policy (timesheets_modify); this is the pre-check that
--  lets the UI explain itself instead of failing a delete silently.
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
