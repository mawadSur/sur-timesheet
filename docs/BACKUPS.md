# Backups & Retention Policy — Sur Portal

The Postgres database is the **system of record for payroll**: `timesheets` are
what people get paid from, and the DB also holds projects, assignments, invoices,
rates, the encrypted credentials vault, and the audit log. Losing it — or losing
the ability to roll it back after a bad delete — is the worst-case failure for
this app. This document defines how we protect it and, crucially, **how to
restore it**.

Two layers, on purpose:

1. **Primary — Supabase managed backups + Point-in-Time Recovery (PITR).**
   Handles the common cases (a bad migration, an accidental mass-delete, a
   dropped table) with minimal data loss. Mostly configured in the Supabase
   dashboard, out of this repo.
2. **Secondary — off-Supabase `pg_dump` snapshots** (`scripts/backup-db.sh`).
   A belt-and-suspenders logical export we control, so we still have a copy if
   the Supabase project itself is lost, suspended, or misconfigured.

---

## 1. Primary: Supabase managed backups + PITR

Configured in the Supabase dashboard for project `sur-timesheet`
(**Database → Backups**). This is the mechanism we rely on day to day.

### What to enable

- **Daily backups** — automatic full backups (available on the Pro plan and up).
  Supabase's default retention on Pro is **7 days**.
- **Point-in-Time Recovery (PITR)** — an add-on that continuously ships WAL so
  you can restore to *any second*, not just the last nightly snapshot. **Enable
  this.** Because timesheets drive payroll, "restore to 30 seconds before the bad
  `DELETE`" is worth far more than "restore to last midnight and lose a day."

> Both are plan/dashboard settings, not code. If the project is still on the Free
> plan, managed daily backups are limited and PITR is unavailable — treat the
> `pg_dump` job below as the real backup until the project is upgraded, and put
> upgrading on the roadmap.

### Retention window (target)

| Layer | Retention | Granularity |
| --- | --- | --- |
| Managed daily backups | **≥ 7 days** (raise to 14–30d if the plan allows) | one restore point per day |
| PITR | **7 days** of WAL (raise if payroll cycle needs it) | any point in time |
| Secondary `pg_dump` (below) | **30 days** rolling | per-run snapshot |

Rationale: 7 days of PITR comfortably covers "someone noticed on Monday that
Friday's data is wrong." The 30-day `pg_dump` window gives a longer, independent
tail for anything discovered late (e.g. an end-of-month payroll reconciliation),
and lives outside Supabase.

---

## 2. Secondary: off-Supabase `pg_dump` snapshots

`scripts/backup-db.sh` takes a compressed, custom-format `pg_dump` of the
`public` schema (all our application tables) and prunes anything older than the
retention window. It is intentionally simple and reads the DB connection string
from an env var — **no secrets are hardcoded**.

### Run it manually

```bash
# Connection string: Supabase → Project Settings → Database → Connection string (URI).
export SUPABASE_DB_URL='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'
./scripts/backup-db.sh
```

Optional overrides: `BACKUP_DIR` (default `<repo>/backups`), `RETENTION_DAYS`
(default `30`), `DUMP_SCHEMA` (default `public`).

### Where dumps are stored & how long they're kept

- **Local runs:** written to `backups/` at the repo root, named
  `sur-portal-<UTC-timestamp>.dump`. Dumps older than `RETENTION_DAYS` (default
  **30**) are deleted on each run.
- **Do not commit dumps.** They contain the full payroll dataset. Add
  `/backups/` to `.gitignore` (see *Follow-ups* below) and, for anything you keep
  long-term, push it to durable off-site storage (a private, encrypted S3/R2
  bucket or the payroll owner's encrypted drive) rather than leaving it only on a
  laptop.

### Scheduling it (recommended)

Pick one; both keep the dump off the Supabase infrastructure.

**GitHub Actions (nightly cron).** A scheduled workflow that installs
`postgresql-client`, runs `scripts/backup-db.sh`, and uploads the resulting
`.dump` as an artifact or pushes it to an encrypted bucket. Store the connection
string as the `SUPABASE_DB_URL` repository secret — never in the workflow file.
Sketch:

```yaml
# .github/workflows/db-backup.yml  (create separately if/when we schedule this)
on:
  schedule:
    - cron: "17 3 * * *"   # 03:17 UTC daily, off-peak
  workflow_dispatch: {}
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get update && sudo apt-get install -y postgresql-client
      - run: ./scripts/backup-db.sh
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
      - uses: actions/upload-artifact@v4
        with:
          name: db-dump
          path: backups/*.dump
          retention-days: 30
```

Use a `pg_dump` version that matches the Supabase Postgres major version (or
newer) — the Ubuntu runner's default may lag; add the PGDG apt repo if so.

**Or a host cron entry** on any always-on machine:

```cron
17 3 * * *  SUPABASE_DB_URL='postgresql://...' /path/to/repo/scripts/backup-db.sh >> /var/log/sur-backup.log 2>&1
```

### The `CREDS_ENCRYPTION_KEY` is a separate backup

The dump includes the `credentials` table, so it contains the **AES-256-GCM
ciphertext** of vault secrets — but **not** `CREDS_ENCRYPTION_KEY`, which lives
only in Vercel and `.env.local`. A restored dump is useless for reading secrets
without that key. **Back the key up separately** (e.g. a password manager entry
owned by the account holder). If the key is lost, every stored credential is
unrecoverable even from a perfect DB backup — the timesheet/payroll data is
fine, but the vault is gone.

---

## 3. Restore procedures

> Restores are destructive and rare. Do a dry run against a throwaway Supabase
> project or a local Postgres before you ever need this for real, and announce a
> short maintenance window before restoring production.

### A. PITR / managed-backup restore (primary path)

Use this for the common cases (bad delete, bad migration).

1. Supabase dashboard → project `sur-timesheet` → **Database → Backups**.
2. **PITR:** pick the exact timestamp *just before* the bad event and start the
   restore. **Managed daily:** pick the nightly restore point instead.
3. Supabase restores the database in place. Expect brief downtime; the app on
   Vercel will reconnect once it's back.
4. **Verify** before telling anyone it's fixed:
   - latest `timesheets` rows look right (spot-check the affected user/date),
   - `profiles` / `allowed_emails` intact (people can still sign in),
   - the credentials vault still decrypts (reveal one credential in `/admin`) —
     confirms the DB and the still-in-Vercel `CREDS_ENCRYPTION_KEY` match.

No env-var changes are needed — same project, same URL and anon key.

### B. Restore from a `pg_dump` snapshot (secondary path)

Use this if the Supabase project itself is gone/suspended and you're rebuilding,
or to seed a fresh/staging project from a snapshot.

1. Stand up the target database:
   - **New Supabase project:** first run `supabase/schema.sql` in the SQL Editor
     so the Supabase-managed pieces (the `auth.users` trigger, `is_admin()`, RLS
     policies, extensions) exist. The custom-format dump was taken with
     `--no-owner --no-privileges` so it lands cleanly into the new project's
     roles.
   - **Local Postgres** (for inspection/recovery): just create an empty database.
2. Restore the dump with `pg_restore` (custom format):

   ```bash
   export TARGET_DB_URL='postgresql://postgres:<password>@db.<new-ref>.supabase.co:5432/postgres'

   # Restore into the public schema. --clean --if-exists makes it idempotent by
   # dropping objects it recreates. Drop --clean for a truly empty target.
   pg_restore \
     --dbname="$TARGET_DB_URL" \
     --no-owner \
     --no-privileges \
     --clean --if-exists \
     backups/sur-portal-<timestamp>.dump
   ```

   To restore only certain tables, add e.g. `--table=timesheets`. To preview
   what a dump contains without touching a DB: `pg_restore --list <file>.dump`.
3. **Foreign keys to `auth.users`:** `profiles.id` references `auth.users(id)`.
   Those auth rows live in the Supabase-managed `auth` schema, which this dump
   does **not** include (managed backups/PITR cover it). Restoring `public` into
   a brand-new project where those users don't exist yet can fail FK checks. For
   a true "rebuild from scratch," recover `auth` from Supabase's own backup, or
   accept that users re-sign-in (Google) to recreate their `auth.users` rows and
   restore only the operational tables (`projects`, `assignments`, `timesheets`,
   `invoices`, …). This is why PITR, not `pg_dump`, is the primary mechanism.
4. Point the app at the new project: update `NEXT_PUBLIC_SUPABASE_URL` and
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` on Vercel, make sure `CREDS_ENCRYPTION_KEY` is
   the **same** value as before (or the vault won't decrypt), and redeploy.
5. Verify as in A.4.

---

## 4. Ownership & cadence

- **Owner:** the payroll/account holder (currently `mawad10101@gmail.com`).
- **Primary:** confirm managed daily backups + PITR are enabled in the dashboard;
  re-check after any plan change.
- **Secondary:** if scheduled, confirm the nightly job is green weekly; if run
  manually, take a `pg_dump` before every risky migration and at each payroll
  close.
- **Test restores:** do a restore dry-run into a throwaway project at least once
  a quarter — an untested backup is not a backup.

## Follow-ups / risks

- **Plan dependency:** managed daily backups and PITR require the Supabase Pro
  plan (or higher). On Free, the `pg_dump` job is the only real backup — upgrade
  the plan to make the primary layer real.
- **`.gitignore`:** add `/backups/` so dumps are never committed. Not done in
  this change (that file is owned elsewhere); wire it in when convenient.
- **Encryption key custody:** `CREDS_ENCRYPTION_KEY` must be backed up
  independently and kept in sync across any restored project, or the vault is
  unrecoverable. This is a manual, out-of-repo step today.
- **Off-site durability:** the script prunes local dumps at 30 days; long-term
  retention needs pushing dumps to encrypted off-site storage (bucket), which
  the GitHub Actions sketch above enables but does not yet configure.
- **`pg_dump` version skew:** keep the client version ≥ the server major version,
  especially on CI runners, or dumps/restores can fail.
