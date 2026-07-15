-- ============================================================================
--  MIGRATION: 20260715120001_crm_recruiting_pipeline
--
--  WHAT THIS DOES
--    Repoints the CRM (PHASE 9) from a generic sales pipeline to a recruiting /
--    contractor pipeline on public.projects:
--      • adds contact_phone (point-of-contact phone number)
--      • replaces the pipeline_stage stage set
--          old: Lead / Qualified / Proposal / Won / Lost
--          new: Offer / Background check / Expected start
--      • estimated_value_cents now holds the candidate's HOURLY RATE (cents);
--        employment type re-uses the existing pay_type column (C2C / W2 / 1099).
--    The `source` column is left in place (legacy) but is no longer surfaced.
--    Copied to mirror supabase/schema.sql (the source of truth).
--
--  IDEMPOTENT & SAFE ON AN EXISTING DB
--    add column IF NOT EXISTS, an UPDATE that clears now-invalid stages, and
--    drop constraint if exists + add — all safe to re-run.
--
--  ENDS WITH A SCHEMA-CACHE RELOAD
--    PostgREST serves reads/writes from an in-memory schema cache; the closing
--    NOTIFY forces it to pick up the new column immediately (see the prior CRM
--    migration for the PGRST205 history).
-- ============================================================================

-- ── New contact phone column (contact_email + pay_type already exist) ───────
alter table public.projects add column if not exists contact_phone text;

-- ── Clear any rows still holding a retired sales stage so the new CHECK can be
--    added without a constraint violation ────────────────────────────────────
update public.projects
   set pipeline_stage = null
 where pipeline_stage is not null
   and pipeline_stage not in ('Offer', 'Background check', 'Expected start');

-- ── Re-point the stage constraint to the recruiting set ─────────────────────
alter table public.projects drop constraint if exists projects_pipeline_stage_check;
alter table public.projects add  constraint projects_pipeline_stage_check
  check (pipeline_stage is null or pipeline_stage in ('Offer', 'Background check', 'Expected start'));

-- ── Force PostgREST to pick up the new column immediately ───────────────────
notify pgrst, 'reload schema';
