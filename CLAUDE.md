# CLAUDE.md — Sur Portal

## Overview

**Sur Portal** is an internal, invite-only team portal. Employees sign in with
Google, an admin assigns them to projects, and everyone logs hours against their
assigned projects. Phase 2 adds an encrypted per-project credentials vault, an
audit log, and access revocation. It is a private internal tool — not a public
product. Live at **https://sur-timesheet.vercel.app** (Vercel project
`sur-timesheet`).

## Tech stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict).
- **Supabase**: Postgres + Google OAuth, accessed via **`@supabase/ssr`**
  (cookie-based sessions). No ORM — queries go straight through the Supabase JS
  client, with **Row Level Security** doing the authorization.
- **Vitest** for unit tests (crypto, books, csv, dates, rescuetime, `requireAdmin`;
  plus env-gated RLS smoke tests).
- **Plain CSS** in `app/globals.css` (no Tailwind/CSS-in-JS).
- Deployed on **Vercel**; auto-deploys on push to `main`.
- Path alias `@/*` maps to the repo root (see `tsconfig.json`).

## Key files & directories

- `app/page.tsx` — employee home: timesheet form, RLS-scoped project list.
- `app/login/page.tsx` — Google sign-in (client component, `signInWithOAuth`).
- `app/auth/callback/route.ts` — OAuth callback; exchanges `code` for a session,
  redirects to `/not-authorized` if the allowlist trigger rejected the email.
- `app/not-authorized/page.tsx` — shown to un-allowlisted / revoked users.
- `app/admin/page.tsx` — admin panel: people & access, projects, assignments,
  logged hours (last 100).
- `app/admin/audit/page.tsx` — audit log viewer (last 200 entries; admin-only).
- `app/admin/export/route.ts` — CSV export of all timesheets (admin-only).
- `app/actions.ts` — core server actions: `signOut`, `submitTimesheet`, allowed-
  email/role management, project + assignment CRUD.
- `app/credentials-actions.ts` — server actions for the credentials vault
  (`addCredential`, `updateCredential`, `deleteCredential`, `getProjectCredentials`).
- `app/access-actions.ts` — `revokeUser` / `restoreUser` (toggle `is_active`).
- `components/TimesheetForm.tsx` — employee hours form (client component).
- `components/AdminCredentials.tsx` — admin credential list + add form (never
  selects ciphertext into the page).
- `components/CredentialsPanel.tsx` — user-facing reveal panel; each reveal calls
  the server and is audit-logged.
- `components/UserAccessControls.tsx` — revoke/restore buttons.
- `lib/supabase/server.ts` — Supabase client for Server Components / actions / route
  handlers.
- `lib/supabase/client.ts` — Supabase client for browser/client components.
- `lib/supabase/middleware.ts` — `updateSession`: refreshes the session, gates
  routes, locks out revoked users, enforces admin-only `/admin`.
- `lib/crypto.ts` — AES-256-GCM encrypt/decrypt for vault secrets.
- `lib/audit.ts` — `logAudit(action, opts)`: best-effort append to `audit_log`.
- `middleware.ts` — wires `updateSession` into Next middleware (runs on all
  non-static routes).
- `config/timesheet.ts` — `BRAND` (name + tagline) only; people/projects live in DB.
- `lib/auth.ts` — shared `requireAdmin()` (loads the user, checks `role = 'admin'`,
  returns `{ supabase, user }`); every admin server action imports this now.
- `lib/supabase/admin.ts` — `createAdminClient()`: tightly-scoped, server-only
  service-role client (returns `null` when `SUPABASE_SERVICE_ROLE_KEY` is unset).
- `lib/books.ts` — billing/invoice math: month windows, per-line money, billable
  invoice-line aggregation (integer cents, half-up rounding).
- `lib/csv.ts` — CSV cell escaping / row building for exports.
- `lib/payroll.ts` — semi-monthly pay-period windows (1st–15th, 16th–month-end) and
  per-contractor payout aggregation (hours × pay_rate) for the admin Payroll page
  (`app/admin/payroll/page.tsx` + `.../export/route.ts`).
- `lib/email.ts` — `sendInviteEmail` via Resend (feature-gated on `RESEND_API_KEY`
  + `INVITE_FROM_EMAIL`; no-op when unset). Fired when a new email is allowlisted.
- `lib/dates.ts` — pure date helpers (`isEnded`, `projectPhase`) for project phase
  (upcoming / active / ended), timezone-safe.
- `lib/tailscale.ts` — `grantTailscaleAccess` / `revokeTailscaleAccess`
  (feature-gated on `TAILSCALE_API_KEY` + `TAILSCALE_TAILNET`; no-op when unset).
- `lib/discord.ts` — Discord status reads + `grant/revokeDiscordChannelAccess`
  (feature-gated on `DISCORD_BOT_TOKEN`; no-op when unset).
- `app/feedback-actions.ts` — continuous-feedback server actions
  (`addFeedback`, `deleteFeedback`, `getProjectFeedback`).
- `app/invoice-actions.ts` — invoice lifecycle server actions (draft / send / mark
  paid / void / regenerate), AR-aware partial-payment handling.
- `app/rescuetime-actions.ts` — `logRescueTimeHours` bridge (buckets tracked time
  into project timesheets, with a per-(user, project, day) double-log guard).
- `app/api/cron/discord-status/route.ts` — cron endpoint (fail-closed on
  `CRON_SECRET`) that summarizes Discord activity via Claude.
- `scripts/rotate-creds-key.mjs` — `CREDS_ENCRYPTION_KEY` rotation script
  (decrypt-with-old / re-encrypt-with-new; two-pass, aborts before any partial write).
- `supabase/schema.sql` — full data model, RLS policies, allowlist trigger, seed.
- `tests/*.test.ts` + `vitest.config.ts` — unit tests (crypto, books, csv, dates,
  rescuetime, `requireAdmin`; plus env-gated RLS smoke tests).
- `docs/CREDS_ROTATION.md` — vault key-rotation runbook.
- `docs/BACKUPS.md` — database backup / retention / restore policy.

## Security model: auth + allowlist + RLS

- **Google OAuth only.** No passwords. Sign-in starts in `app/login/page.tsx`,
  returns through `app/auth/callback/route.ts`.
- **Allowlist is the gate.** The `handle_new_user` Postgres trigger fires on
  `auth.users` insert: if the email isn't in `allowed_emails` (or `is_active` is
  false), it `raise exception`s and **no profile/account is created**. Add an
  email *before* the person signs in.
- **RLS on every table.** Employees see only their own `profiles`, `timesheets`,
  and `assignments`, plus the `projects` (and `credentials`) for projects they're
  assigned to. Admins see/manage everything.
- **`is_admin()`** is a `security definer` SQL function that checks
  `profiles.role = 'admin'` for `auth.uid()` — used inside policies without
  triggering RLS recursion.
- **Middleware** (`lib/supabase/middleware.ts`) refreshes the session on every
  request, redirects unauthenticated users to `/login`, sends `is_active = false`
  users to `/not-authorized` immediately, and bounces non-admins off `/admin`.
- Server actions defensively re-check admin via `requireAdmin()`; RLS is still the
  backstop if that check were ever bypassed.

## Credentials vault security model

- Secrets are encrypted **at rest** as AES-256-GCM ciphertext in
  `credentials.secret_encrypted`. The DB **never stores plaintext**.
- Ciphertext layout (base64): `[ iv(12) | authTag(16) | ciphertext ]`. The GCM
  auth tag means tampering/wrong-key decryption **throws** rather than returning
  garbage.
- **Decryption is server-side only** (`lib/crypto.ts` runs in Server Actions).
  `getProjectCredentials` decrypts only after confirming the caller is an admin or
  assigned to the project; RLS enforces row visibility as a second layer.
- **Every reveal is audited** via `logAudit('view_credential', …)`. Create /
  update / delete are audited too.
- **Never log secret values.** `lib/audit.ts` and `getProjectCredentials` pass
  only labels / project names / ids as `target`/`metadata` — never the decrypted
  secret. Keep it that way.
- The admin list view (`AdminCredentials.tsx`) deliberately does **not** select
  the ciphertext column into the page.

## Environment variables

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (public, client + server). **Required.** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (public; RLS is the real guard). **Required.** |
| `CREDS_ENCRYPTION_KEY` | 32-byte key (64 hex chars, or base64) for AES-256-GCM vault encryption. **Server-only secret. Required for the vault.** |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service-role key for `createAdminClient()` (admin-API paths: offboarding hard-delete, Discord-status cron, Tailscale/Discord provisioning). Absent ⇒ those paths no-op. **Never expose to the client.** |
| `CRON_SECRET` | Bearer secret Vercel Cron sends to `/api/cron/*`. The discord-status route is **fail-closed**: unset ⇒ every cron call returns 401. Required to run the cron. |
| `DISCORD_BOT_TOKEN` | Discord bot token for status reads + channel-access grant/revoke. **Optional / feature-gated** — unset ⇒ Discord integration no-ops. |
| `ANTHROPIC_API_KEY` | Claude API key used by the discord-status cron to summarize activity. **Optional / feature-gated** — unset ⇒ summarization is skipped. |
| `TAILSCALE_API_KEY` | Tailscale API key for auto-invite / ACL provisioning. **Optional / feature-gated** — needs `TAILSCALE_TAILNET` too; either unset ⇒ Tailscale integration no-ops. |
| `TAILSCALE_TAILNET` | Tailscale tailnet name (e.g. `example.com`). Pairs with `TAILSCALE_API_KEY`. **Optional / feature-gated.** |
| `RESCUETIME_API_KEY` | RescueTime Analytic Data API key for the hours bridge (`lib/rescuetime.ts`). **Optional / feature-gated** — unset ⇒ the RescueTime bridge returns no data. |
| `RESEND_API_KEY` | Resend API key for outbound invite emails (`lib/email.ts`). **Optional / feature-gated** — needs `INVITE_FROM_EMAIL` too; either unset ⇒ invite emails no-op. |
| `INVITE_FROM_EMAIL` | From address for invite emails (must sit on a Resend-verified domain). Pairs with `RESEND_API_KEY`. **Optional / feature-gated.** |
| `NEXT_PUBLIC_SITE_URL` | Public base URL used in invite-email links. **Optional** — defaults to `https://sur-timesheet.vercel.app`. |

Set the **required** vars on **Vercel** (all environments) and in local
**`.env.local`**; add the optional/feature-gated ones only when you turn that
integration on. `.env*.local` and `.env` are gitignored — never commit them.
Tests inject a fixed deterministic key via `vitest.config.ts`.

## Local dev & deploy

```bash
npm install
# fill .env.local with the three vars above
npm run dev      # http://localhost:3000
npm run build    # production build (type-checks)
npm test         # vitest run (crypto tests)
vercel --prod    # manual production deploy
```

Pushing to `main` **auto-deploys** to production on Vercel. First-time Supabase /
Google OAuth setup is in `README.md`.

## Conventions

- **Server actions** live in `app/actions.ts` and the `app/*-actions.ts` files
  (all marked `"use server"`). Mutations go through these; pages read with the
  server Supabase client and rely on RLS.
- **Admin actions** start with `requireAdmin()`; **mutations call `revalidatePath`**.
- **Styling is plain CSS** in `app/globals.css`. Reusable classes include:
  `.topbar` / `.topnav` / `.navlink` (header + nav), `.page` / `.page.admin`
  (layout), `.card` / `.card-title` (sections), `.btn` / `.btn-sm` / `.submit` /
  `.secondary` / `.link-btn` (buttons), `.tbl` (tables), `.field` / `.field-row` /
  `.inline-form` / `.stack-form` / `.row-form` (forms), `.badge` / `.badge-ok` /
  `.count-pill` (status pills), `.alert` / `.alert-error` (messages), `.auth-card`
  / `.google-btn` (login). CSS variables (colors, radius, shadow) are in `:root`.
- **RLS-first.** Authorize through RLS + the allowlist trigger by default. There
  **is** a service-role client (`lib/supabase/admin.ts`, `createAdminClient()`),
  but it is **tightly scoped and server-only** — it exists solely for the handful
  of paths that genuinely need admin-API access that RLS can't express: hard-
  deleting an auth user on offboarding, the Discord-status cron, and Tailscale/
  Discord provisioning. It returns `null` when `SUPABASE_SERVICE_ROLE_KEY` is
  unset (defensive no-op). Do **not** reach for it in ordinary reads/mutations —
  those still go through the anon client + RLS. Never expose the service-role key
  to the client.
- The data model lives in the DB and is managed from `/admin` — adding people /
  projects / assignments needs no code change or redeploy.

## Security rules

- **Never commit secrets** — keys live in `.env.local` (gitignored) and Vercel.
- **Never log decrypted credential values** — audit by label/id only.
- **Allowlist before access** — add the email to `allowed_emails` before sign-in.
- **Revoke via `is_active`** — set `allowed_emails.is_active` and
  `profiles.is_active` to false (`revokeUser`); middleware locks them out on the
  next request. (Full auth-account deletion is a future hardening item.)
