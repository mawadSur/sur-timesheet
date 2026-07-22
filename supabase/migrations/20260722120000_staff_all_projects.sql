-- ============================================================================
--  Staff role: see every project, log hours anywhere — but never any money.
--
--  Staff are a restricted support type who float across the whole portfolio, so
--  they need the full project list and the ability to log hours against any of
--  it. Widening those two policies means a staff member can now read EVERY
--  `projects` row, which makes the two billing columns still sitting on that
--  row a leak. So this migration first performs the same split already used for
--  project_crm / assignment_rates / expenses / invoices — money lives only
--  where is_admin() can reach it — then widens the policies.
--
--  1. project_billing   — bill_to / payment_terms_days move OFF projects.
--  2. projects_select   — staff read every project.
--  3. timesheets_insert — staff log hours against any project, not just assigned.
--
--  Idempotent.
-- ============================================================================

-- Defensive: is_staff() ships in the Phase 6 block, but re-declaring it here
-- keeps this migration runnable against an older database.
create or replace function public.is_staff()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'staff' and coalesce(is_active, true)
  );
$$;

-- ── 1. Billing defaults move to an admin-only table ─────────────────────────
-- These are per-project invoice defaults (who we bill, and the net-N terms used
-- to compute a due date). They are seeded onto an invoice at generate/send time
-- and are not needed by any employee-facing read.
create table if not exists public.project_billing (
  project_id         uuid primary key references public.projects(id) on delete cascade,
  bill_to            text,
  payment_terms_days integer not null default 30,
  updated_at         timestamptz not null default now()
);

-- Backfill before dropping, and only from a database that still has the columns
-- (so a re-run is a no-op). Projects left on the defaults get no row — the
-- application falls back to net-30 / no bill-to when the row is absent.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'bill_to'
  ) then
    insert into public.project_billing (project_id, bill_to, payment_terms_days)
    select p.id, p.bill_to, coalesce(p.payment_terms_days, 30)
    from public.projects p
    where p.bill_to is not null or coalesce(p.payment_terms_days, 30) <> 30
    on conflict (project_id) do nothing;
  end if;
end $$;

alter table public.projects drop column if exists bill_to;
alter table public.projects drop column if exists payment_terms_days;

alter table public.project_billing enable row level security;
drop policy if exists project_billing_admin on public.project_billing;
create policy project_billing_admin on public.project_billing
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── 2. Staff see every project ──────────────────────────────────────────────
-- Employees keep the assignment-scoped view; staff get the whole list. The row
-- itself now carries only operational metadata (name, dates, status, hosts,
-- manager, Discord channel) — no money.
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

-- ── 3. Staff log hours against any project ──────────────────────────────────
-- Employees still need an assignment; staff do not, so a floating support person
-- can book time to whatever they were pulled onto that week.
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

-- Let PostgREST see the reshaped columns immediately.
notify pgrst, 'reload schema';
