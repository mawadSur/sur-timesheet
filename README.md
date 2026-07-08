# Sur Portal

An internal team portal for Sur. Employees **sign in with Google**, an admin
**assigns them to projects**, and everyone logs hours against their assigned
projects. Built on Next.js + Supabase, deployed on Vercel.

> **Shipped:** Google login · email allowlist · admin panel (people, projects &
> assignments) · timesheets + CSV export · encrypted VM/PiKVM credentials vault ·
> audit log · access revocation + auth-account hard-delete · billing/invoices &
> AR aging · project durations · continuous feedback · RescueTime bridge.
>
> **Scaffolded (needs secrets + design decisions to switch on):** Tailscale
> auto-provisioning (invite + ACLs) and Discord channel access — see
> [`TODOS.md`](./TODOS.md).

---

## One-time setup (~15 min)

You need a free [Supabase](https://supabase.com) project and a Google OAuth
client. Both use **your** accounts, so these steps are yours to run.

### 1. Create the Supabase project
- New project at [supabase.com](https://supabase.com) → wait for it to provision.
- **Project Settings → API**, copy:
  - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
  - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Create the database
- **SQL Editor → New query**, paste all of [`supabase/schema.sql`](./supabase/schema.sql), and run it.
- It creates the tables, security rules, the sign-in allowlist trigger, and
  seeds **you** (`mawad10101@gmail.com`) as the first admin. Change that line
  first if you want a different admin.

> ⚠️ **Migration reminder:** `supabase/schema.sql` is the source of truth and has
> grown newer objects — the **`feedback`** table (+ RLS) and the
> **`profiles.discord_user_id`** column. If your database predates them, **re-run
> `supabase/schema.sql` against Supabase before the continuous-feedback UI or
> Discord provisioning will work at runtime.** The script is idempotent, so
> re-running on an existing DB is safe.

### 3. Turn on Google login
- In Supabase: **Authentication → Providers → Google → enable**.
- Create a Google OAuth client at
  [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services
  → Credentials → **OAuth client ID** (type: Web application).
  - **Authorized redirect URI:** the callback URL shown on the Supabase Google
    provider page (looks like `https://YOUR-PROJECT.supabase.co/auth/v1/callback`).
  - Paste the resulting **Client ID** and **Client secret** into Supabase, save.
- In Supabase **Authentication → URL Configuration**:
  - **Site URL:** `https://sur-timesheet.vercel.app`
  - **Redirect URLs:** add `https://sur-timesheet.vercel.app/**` and
    `http://localhost:3000/**`.

### 4. Give the app the keys (Vercel)
```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL        # paste Project URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY   # paste anon key
vercel env add CREDS_ENCRYPTION_KEY            # 64 hex chars — enables the vault
vercel --prod                                  # redeploy
```
(Add to all environments when prompted so previews work too.)

**Optional / feature-gated env vars** — set these only when you turn the matching
feature on; each integration cleanly no-ops while its var is unset (the cron is the
exception — it fail-closes without its secret). See the full table in
[`CLAUDE.md`](./CLAUDE.md#environment-variables).

| Var | Enables |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin-API paths: offboarding hard-delete, Discord-status cron, provisioning. **Server-only — never expose.** |
| `CRON_SECRET` | Auth for `/api/cron/*`; the discord-status route **fail-closes** (401) without it. |
| `DISCORD_BOT_TOKEN` | Discord status reads + channel-access grant/revoke. |
| `ANTHROPIC_API_KEY` | Claude summarization in the discord-status cron. |
| `TAILSCALE_API_KEY` + `TAILSCALE_TAILNET` | Tailscale auto-invite / ACL provisioning. |

That's it — sign in with Google at the site, and you'll land in `/admin`.

---

## Running it day to day (admin panel)

Everything is managed in-app at **`/admin`** (admins only):

- **People & access** — add an email *before* someone signs in (Google login is
  invite-only). Set anyone to Employee or Admin.
- **Projects** — create projects with optional dates and the Tailscale VM/PiKVM
  link.
- **Assignments** — assign people to projects. A person only sees (and can log
  hours against) the projects they're assigned to.
- **Logged hours** — review everyone's entries; **Export CSV** for payroll.

No code changes or redeploys needed for any of this.

---

## Local development

```bash
npm install
# put your Supabase URL + anon key (+ CREDS_ENCRYPTION_KEY) in .env.local
npm run dev      # http://localhost:3000
npm test         # vitest run
```

---

## Maintenance & operations

- **Rotate the vault key** — runbook + script (`scripts/rotate-creds-key.mjs`) for
  rotating `CREDS_ENCRYPTION_KEY` without data loss:
  [`docs/CREDS_ROTATION.md`](./docs/CREDS_ROTATION.md).
- **Backups & restore** — database backup / retention / restore policy
  (managed daily backups + PITR, plus a `pg_dump` secondary layer):
  [`docs/BACKUPS.md`](./docs/BACKUPS.md).

---

## How it fits together

```
Employee (Google login)
      │
      ▼
Next.js on Vercel ──── Supabase Postgres
      ├── @supabase/ssr   (session in cookies, refreshed by middleware)
      ├── allowlist trigger (only invited emails can create an account)
      └── Row Level Security (employees see only their own data & projects)
```

Key files: `supabase/schema.sql` (data model + security), `middleware.ts` +
`lib/supabase/*` (auth/session), `app/admin/*` (admin panel), `app/actions.ts`
(all mutations), `components/TimesheetForm.tsx` (the employee form).
