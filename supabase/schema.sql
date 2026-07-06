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
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ── On sign-in: enforce the allowlist and create the profile ──────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_role text;
begin
  select role into allowed_role
  from public.allowed_emails
  where lower(email) = lower(new.email);

  if allowed_role is null then
    raise exception 'Email % is not authorized for the Sur Portal', new.email;
  end if;

  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
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
    public.is_admin() or exists (
      select 1 from public.assignments a
      where a.project_id = projects.id and a.user_id = auth.uid()
    )
  );
drop policy if exists projects_write_admin on public.projects;
create policy projects_write_admin on public.projects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- assignments: employees see own; admin manages all
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists assignments_write_admin on public.assignments;
create policy assignments_write_admin on public.assignments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- timesheets: employees see/insert own (only for assigned projects); admin sees all
drop policy if exists timesheets_select on public.timesheets;
create policy timesheets_select on public.timesheets
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists timesheets_insert on public.timesheets;
create policy timesheets_insert on public.timesheets
  for insert to authenticated with check (
    user_id = auth.uid() and exists (
      select 1 from public.assignments a
      where a.user_id = auth.uid() and a.project_id = timesheets.project_id
    )
  );
drop policy if exists timesheets_modify on public.timesheets;
create policy timesheets_modify on public.timesheets
  for delete to authenticated using (user_id = auth.uid() or public.is_admin());

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

-- Re-create the signup trigger so it also blocks revoked accounts.
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
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    allowed_role
  );
  return new;
end;
$$;

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
  for insert to authenticated with check (auth.uid() is not null);

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
  for select to authenticated using (
    public.is_admin() or exists (
      select 1 from public.assignments a
      where a.project_id = time_off.project_id and a.user_id = auth.uid()
    )
  );
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
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  bill_rate  numeric(10,2),   -- what the client pays per hour (revenue side)
  pay_rate   numeric(10,2),   -- what we pay the consultant per hour (cost side)
  updated_at timestamptz not null default now()
);

alter table public.assignment_rates enable row level security;
drop policy if exists assignment_rates_admin on public.assignment_rates;
create policy assignment_rates_admin on public.assignment_rates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Billing metadata on projects. Used by the invoice phases (M2); harmless now.
alter table public.projects add column if not exists bill_to text;
alter table public.projects add column if not exists payment_terms_days integer not null default 30;

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
    select 1 from public.profiles where id = auth.uid() and role = 'staff'
  );
$$;

-- Credentials: admin sees all; assigned NON-staff users see their projects'.
-- Staff are blocked from the vault even on projects they're assigned to.
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
