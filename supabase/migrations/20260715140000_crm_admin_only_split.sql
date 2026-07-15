-- ============================================================================
--  CRM ADMIN-ONLY SPLIT — 2026-07-15
--
--  Moves the recruiting-pipeline candidate PII + hourly-rate fields OFF the
--  employee-readable public.projects row into a new admin-only table
--  public.project_crm. projects_select is ROW-level (an assigned non-admin
--  employee can read their project's whole row via the REST API), so candidate
--  contact info and rate must sit behind is_admin() — the same pattern already
--  used for assignment_rates / expenses / invoices. `pay_type` (employment type)
--  stays on projects as operational, non-sensitive metadata.
--
--  Idempotent & data-preserving: create the table, copy existing values (guarded
--  on the old columns still existing), then drop the columns. Safe to re-run.
-- ============================================================================

create table if not exists public.project_crm (
  project_id            uuid primary key references public.projects(id) on delete cascade,
  pipeline_stage        text check (pipeline_stage is null or pipeline_stage in ('Offer','Background check','Expected start')),
  contact_name          text,
  contact_email         text,
  contact_phone         text,
  source                text,
  next_step             text,
  next_step_on          date,
  estimated_value_cents bigint,
  updated_at            timestamptz not null default now()
);

alter table public.project_crm enable row level security;
drop policy if exists project_crm_admin on public.project_crm;
create policy project_crm_admin on public.project_crm
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Copy any existing CRM data off projects (only while the old columns exist, so
-- a second run after the drop below is a no-op rather than an error).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'pipeline_stage'
  ) then
    insert into public.project_crm
      (project_id, pipeline_stage, contact_name, contact_email, contact_phone, source, next_step, next_step_on, estimated_value_cents)
    select id, pipeline_stage, contact_name, contact_email, contact_phone, source, next_step, next_step_on, estimated_value_cents
    from public.projects
    where pipeline_stage is not null or contact_name is not null or contact_email is not null
       or contact_phone is not null or source is not null or next_step is not null
       or next_step_on is not null or estimated_value_cents is not null
    on conflict (project_id) do nothing;
  end if;
end $$;

-- Drop the now-migrated columns from the employee-readable projects table.
alter table public.projects drop constraint if exists projects_pipeline_stage_check;
alter table public.projects drop column if exists pipeline_stage;
alter table public.projects drop column if exists contact_name;
alter table public.projects drop column if exists contact_email;
alter table public.projects drop column if exists contact_phone;
alter table public.projects drop column if exists source;
alter table public.projects drop column if exists next_step;
alter table public.projects drop column if exists next_step_on;
alter table public.projects drop column if exists estimated_value_cents;

notify pgrst, 'reload schema';
