# TODOS.md — Sur Portal backlog

Prioritized backlog. Each open item lists **What / Why / Effort (S/M/L) /
Priority (P1–P3)** and **Depends on**.

> ⚠️ **Apply the schema migration first.** `supabase/schema.sql` has new objects —
> the **`feedback`** table (+ index/RLS) and the **`profiles.discord_user_id`**
> column — that the feedback UI and Discord provisioning need at runtime. Re-run
> `supabase/schema.sql` against the live DB (idempotent; safe on an existing DB).

---

<details>
<summary><strong>Recently shipped ✅</strong> (click to expand)</summary>

- **Phase 2 UI wired into `/admin`** — credentials vault, revoke/restore, `/admin/audit` link.
- **Project durations** — editable `starts_on`/`ends_on` + auto Active/Ended/Upcoming badges (`lib/dates.ts`).
- **Hard-delete offboarding** — `deleteUserAccount` via `createAdminClient()`; revoked-users only, self-delete guard, clean no-op without the service-role key.
- **`CREDS_ENCRYPTION_KEY` rotation** — `scripts/rotate-creds-key.mjs` (two-pass, `--dry-run`, aborts before partial writes) + `docs/CREDS_ROTATION.md`; `lib/crypto.ts` takes an optional explicit key.
- **Test coverage broadened** — `books` / `csv` / `dates` / `rescuetime` / `requireAdmin` (`lib/auth.ts`); 58 passing (+3 env-gated RLS smoke).
- **Bug fixes** — AR aging now counts partial payments (`markInvoicePaid` keeps partials `sent`); invoice void/pay state guards; RescueTime most-specific-keyword-wins + double-log guard; `/api/cron` fail-closed when `CRON_SECRET` is unset.

</details>

---

## Remaining / partial

- [ ] **Tailscale auto-invite + ACLs on assignment — SCAFFOLDED.**
  - **What:** `lib/tailscale.ts` (`grant/revokeTailscaleAccess`) is wired into
    `assignProject` / `unassignProject` / `revokeUser` and no-ops until secrets are
    set. Still stubbed: the project-tag → device-ACL grant (`TODO(tag-scheme)`), and
    revoke only clears *pending* invites, not already-accepted members.
  - **Why:** Closes the loop from "assigned in the portal" to "can reach the box,"
    least-privilege.
  - **Effort:** M · **Priority:** P1
  - **Depends on:** `TAILSCALE_API_KEY` + `TAILSCALE_TAILNET` secrets **and** an
    agreed device **tag scheme** (`projects.tailscale_tag` column exists).
- [ ] **Discord channel auto-access — SCAFFOLDED.**
  - **What:** `lib/discord.ts` (`grant/revokeDiscordChannelAccess`) is wired into
    assign / unassign / revoke; no-ops until the bot token is set and a user's
    Discord identity is known.
  - **Why:** Same provisioning convenience as Tailscale, for team comms.
  - **Effort:** M · **Priority:** P2
  - **Depends on:** `DISCORD_BOT_TOKEN` **and** a UI to capture each user's Discord
    identity into `profiles.discord_user_id` (column added — **apply the migration**).
- [ ] **Continuous feedback module — BUILT, needs migration.**
  - **What:** `feedback` table + admin UI (`app/feedback-actions.ts`, surfaced on the
    project page) for running per-person / per-project notes.
  - **Why:** Lightweight continuous feedback was on the original roadmap.
  - **Effort:** — (built) · **Priority:** P2
  - **Depends on:** applying the `feedback` table + RLS migration from
    `supabase/schema.sql`.
- [ ] **Backups / retention policy — DOCUMENTED, needs enabling.**
  - **What:** Policy + `scripts/backup-db.sh` (`pg_dump` secondary layer) live in
    `docs/BACKUPS.md`; the primary layer (managed daily backups + PITR) still needs
    turning on.
  - **Why:** Timesheets are the payroll system-of-record; loss/corruption is costly.
  - **Effort:** S · **Priority:** P3
  - **Depends on:** enabling **Supabase managed backups + PITR** (Pro plan) for
    project `sur-timesheet`; back up `CREDS_ENCRYPTION_KEY` separately (dumps hold
    only ciphertext).

### Nice-to-have follow-ups

- [ ] **CSV formula-injection guard** (S · P3) — `lib/csv.ts` emits `=`/`+`/`-`/`@`
  cells verbatim; add a leading-quote neutralizer on the export path.
- [ ] **Partial-payment UX** (S · P3) — `amount_received_cents` is an absolute total
  (overwrite), so a top-up payment needs the *cumulative* amount; the "received /
  balance due" badge helps, but a per-payment ledger would be cleaner if ever needed.

---

## Frontend / navigation (make the app easier to get around)

Reviewed 2026-07-16. Every page hand-rolls its own `<nav className="topnav">`, so
the reachable sections change page to page and there is no "you are here" cue. From
**Invoices** you can only reach Admin + Books; from **RescueTime**/**Audit** only
Admin + Timesheet; **Books** can't reach Dashboard/CRM/RescueTime/Audit — you bounce
through `/admin` to get anywhere.

- [ ] **One shared `<TopNav>` component — replace the ~10 hand-copied navs.**
  - **What:** Extract `components/TopNav.tsx` (an admin variant + an employee
    variant) that renders ONE consistent link set, and use it on every page in
    place of each hand-rolled `<nav className="topnav">` block.
  - **Why:** Ends the per-page link drift so every section is reachable from
    everywhere; single source of truth for the header.
  - **Effort:** M · **Priority:** P1
  - **Depends on:** nothing.
- [ ] **Active-state highlighting in the nav.**
  - **What:** Mark the current section via client `usePathname()` +
    `aria-current="page"` and a visual accent (underline or pill). Fold into `<TopNav>`.
  - **Why:** 9 identical `.navlink`s today give zero indication of where you are.
  - **Effort:** S · **Priority:** P1
  - **Depends on:** shared `<TopNav>`.
- [ ] **Make the logo / wordmark a home link.**
  - **What:** Wrap `.logo`/`.wordmark` in a `<Link>` (admin → `/admin`, employee →
    `/`). It's a plain `<div>` right now.
  - **Why:** Click-logo-to-go-home is a universal affordance; its absence makes
    pages feel like dead ends.
  - **Effort:** S · **Priority:** P2
  - **Depends on:** shared `<TopNav>` (ship together).
- [ ] **Group the nav + separate utilities.**
  - **What:** Cluster the money section (Books · Invoices · Payroll · Payroll runs)
    and push utilities (Export CSV, Audit, Log out) to the right; consider a
    "More ▾" overflow for the long tail on the hub.
  - **Why:** Primary sections and one-off utilities are styled identically today.
  - **Effort:** M · **Priority:** P2
  - **Depends on:** shared `<TopNav>`.
- [ ] **Breadcrumbs on detail pages.**
  - **What:** Add a trail on `/admin/invoices/[id]`, `/admin/projects/[id]`, and
    `/admin/payroll/runs/[id]` (e.g. "Invoices / #INV-123").
  - **Why:** Detail pages have no consistent back / where-am-I trail.
  - **Effort:** S · **Priority:** P2
  - **Depends on:** nothing.
- [ ] **Responsive nav.**
  - **What:** Collapse the top bar to a disclosure/menu under a narrow breakpoint
    instead of wrapping the flat link row.
  - **Why:** The tool does get opened on phones; the wrapping bar is rough there.
  - **Effort:** M · **Priority:** P3
  - **Depends on:** shared `<TopNav>`.

---

## Out of scope (intentionally deferred — it's an internal tool)

- **Custom domain** — the `*.vercel.app` URL is fine for an internal audience.
- **Mobile app** — the responsive web UI covers occasional mobile use.
- **Analytics dashboards** — CSV export + the admin tables are enough for now.
- **SSO beyond Google** — the whole team is on Google; no other IdP needed.
- **Internationalization (i18n)** — single-language internal team.
- **Multi-tenant** — one organization only; no tenant isolation required.
