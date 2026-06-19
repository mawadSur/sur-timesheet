# Sur Portal

An internal team portal for Sur. Employees **sign in with Google**, an admin
**assigns them to projects**, and everyone logs hours against their assigned
projects. Built on Next.js + Supabase, deployed on Vercel.

> **Phase 1 (this release):** Google login · email allowlist · admin panel to
> manage people, projects & assignments · timesheets in the database · CSV export.
>
> **Roadmap:** per-project encrypted VM/PiKVM credentials vault → Tailscale
> auto-provisioning (invite + ACLs) → Discord channel access → project durations
> & continuous feedback.

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
vercel --prod                                  # redeploy
```
(Add to all environments when prompted so previews work too.)

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
# put your Supabase URL + anon key in .env.local
npm run dev      # http://localhost:3000
```

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
