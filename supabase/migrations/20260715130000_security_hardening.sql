-- ============================================================================
--  SECURITY HARDENING — 2026-07-15
--  Idempotent. Safe to run repeatedly on the live DB.
--
--  Goals:
--   * A revoked/inactive user (profiles.is_active = false) gets NO data even
--     with a still-valid JWT. NULL is_active is treated as active — mirrors the
--     middleware, which only locks out an explicit is_active = false.
--   * A revoked admin/staff loses that role (is_admin()/is_staff() go false).
--   * Users can only insert audit rows attributed to themselves (no actor
--     spoofing / admin impersonation).
--   * time_off is admin-only (removes a cross-employee PII leak of coworkers'
--     absence name/dates/notes).
--   * Profile emails are normalized to lowercase (new rows + one-time backfill).
-- ============================================================================

-- ── Helper: am I an active (non-revoked) user? ────────────────────────────────
-- Gates the employee/staff branches of the policies below. NULL is_active is
-- treated as active; only an explicit is_active = false blocks.
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

-- ── Harden is_admin(): a revoked admin loses the role ─────────────────────────
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

-- ── Harden is_staff(): a revoked staff member loses the role ──────────────────
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

-- ── Gate employee/staff read branches on is_active_user() ─────────────────────
-- Admins still pass via is_admin(); profiles_select self-read is intentionally
-- left ungated so a user (and the middleware) can still read their own row.

-- projects: assigned employees must be active
drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated using (
    public.is_admin() or (public.is_active_user() and exists (
      select 1 from public.assignments a
      where a.project_id = projects.id and a.user_id = auth.uid()
    ))
  );

-- assignments: employees see own only while active
drop policy if exists assignments_select on public.assignments;
create policy assignments_select on public.assignments
  for select to authenticated using (public.is_admin() or (public.is_active_user() and user_id = auth.uid()));

-- timesheets: employees see own only while active
drop policy if exists timesheets_select on public.timesheets;
create policy timesheets_select on public.timesheets
  for select to authenticated using (public.is_admin() or (public.is_active_user() and user_id = auth.uid()));

-- timesheets: employees insert own only while active (and only for assigned projects)
drop policy if exists timesheets_insert on public.timesheets;
create policy timesheets_insert on public.timesheets
  for insert to authenticated with check (
    user_id = auth.uid() and public.is_active_user() and exists (
      select 1 from public.assignments a
      where a.user_id = auth.uid() and a.project_id = timesheets.project_id
    )
  );

-- timesheets: employees delete own only while active
drop policy if exists timesheets_modify on public.timesheets;
create policy timesheets_modify on public.timesheets
  for delete to authenticated using (public.is_admin() or (public.is_active_user() and user_id = auth.uid()));

-- credentials (PHASE 6 winning definition): admin sees all; assigned NON-staff
-- users see their projects' rows only while active. Staff remain blocked.
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

-- feedback: a subject may read feedback about themselves only while active
drop policy if exists feedback_subject_select on public.feedback;
create policy feedback_subject_select on public.feedback
  for select to authenticated using (public.is_active_user() and subject_profile_id = auth.uid());

-- ── audit_log: an inserter may only attribute rows to themselves ──────────────
drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log
  for insert to authenticated with check (actor_id = auth.uid());

-- ── time_off: admin-only (no employee page reads it) ──────────────────────────
drop policy if exists time_off_select on public.time_off;
create policy time_off_select on public.time_off
  for select to authenticated using (public.is_admin());

-- ── Email-case normalization ──────────────────────────────────────────────────
-- New profiles store the email lowercased (the allowlist lookup already uses
-- lower() on both sides).
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

-- One-time backfill: normalize any existing mixed-case emails so the admin
-- actions (revoke/restore/setRole/removeAllowedEmail), which match on a
-- lowercased input with .eq(), reliably hit the row.
update public.profiles      set email = lower(email) where email is distinct from lower(email);
update public.allowed_emails set email = lower(email) where email is distinct from lower(email);

-- ── Reload PostgREST schema cache so the new definitions take effect ──────────
notify pgrst, 'reload schema';
