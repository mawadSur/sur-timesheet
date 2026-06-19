# TODOS.md — Sur Portal backlog

Prioritized backlog. Each item lists **What / Why / Effort (S/M/L) / Priority
(P1–P3)** and **Depends on** where relevant.

---

## Wire up existing Phase 2 UI

These pieces are built but not yet surfaced in the admin panel
(`app/admin/page.tsx`). Doing this first unlocks the features already shipped.

- [ ] **Surface the credentials vault in `/admin`.**
  - **What:** Render `AdminCredentials` per project (manage) and expose
    `CredentialsPanel` to assigned users so they can reveal project secrets.
  - **Why:** The vault, encryption, RLS, and audit logging all exist; the admin
    page just doesn't render them yet.
  - **Effort:** S · **Priority:** P1
- [ ] **Surface revoke/restore + the audit log link in `/admin`.**
  - **What:** Add `UserAccessControls` (revoke/restore) to the People table and a
    nav link to `/admin/audit`; show `is_active` status.
  - **Why:** `revokeUser` / `restoreUser` and `/admin/audit` exist but aren't
    reachable from the UI.
  - **Effort:** S · **Priority:** P1

---

## Roadmap

- [ ] **Phase 3 — Tailscale auto-invite + ACLs on assignment.**
  - **What:** When an admin assigns someone to a project, call the Tailscale API
    to invite that person's Google email to the tailnet and set ACL grants so they
    can reach only their project's tagged VM/PiKVM devices. Remove access on
    unassign/revoke.
  - **Why:** Closes the loop from "assigned in the portal" to "can actually reach
    the box," with least-privilege network access.
  - **Effort:** L · **Priority:** P1
  - **Depends on:** a Tailscale API token (server secret) + an agreed device
    **tag scheme** (the `projects.tailscale_tag` column already exists).
- [ ] **Discord channel auto-access.**
  - **What:** On assignment, auto-grant the person access to the project's Discord
    channel; revoke on unassign.
  - **Why:** Same provisioning convenience as Tailscale, for team comms.
  - **Effort:** M · **Priority:** P2
  - **Depends on:** a Discord bot + users linking their Discord identity to their
    portal account.
- [ ] **Project durations UI.**
  - **What:** Surface `starts_on` / `ends_on` in the admin project editor and in
    reports (e.g. flag active vs. ended projects).
  - **Why:** The columns already exist in `projects` and are captured on create,
    but aren't meaningfully used beyond display.
  - **Effort:** S · **Priority:** P2
- [ ] **Continuous feedback module.**
  - **What:** New table + UI for ongoing per-person / per-project notes (running
    feedback log rather than point-in-time reviews).
  - **Why:** Lightweight continuous feedback was part of the original roadmap.
  - **Effort:** M · **Priority:** P2
  - **Depends on:** new table + RLS policies in `supabase/schema.sql`.

---

## Hardening follow-ups

- [ ] **Hard-delete an auth account on offboarding.**
  - **What:** On full offboarding, delete the user's Supabase `auth.users` row (not
    just flip `is_active`).
  - **Why:** `is_active` only locks the user out; the account still exists. A true
    delete is cleaner for departures.
  - **Effort:** M · **Priority:** P2
  - **Depends on:** a **service-role** Supabase admin client (server-only, tightly
    scoped — currently the codebase has none by design).
- [ ] **Document a `CREDS_ENCRYPTION_KEY` rotation procedure.**
  - **What:** Write + script a key-rotation flow: decrypt all `credentials` with the
    old key and re-encrypt with the new one, then swap the env var on Vercel.
  - **Why:** Vault secrets are only as safe as the key; rotation must be possible
    without data loss.
  - **Effort:** M · **Priority:** P2
- [ ] **Broaden test coverage to server actions.**
  - **What:** Add tests around `submitTimesheet`, `requireAdmin`, allowlist/role
    logic, and `getProjectCredentials` authorization paths.
  - **Why:** Today only `lib/crypto.ts` is tested; the security-sensitive action
    layer is uncovered.
  - **Effort:** M · **Priority:** P2
- [ ] **Backups / retention policy for timesheets.**
  - **What:** Define and configure backup + retention for the Postgres data
    (timesheets are the payroll system-of-record).
  - **Why:** This is financial source data; loss or corruption is costly.
  - **Effort:** S · **Priority:** P3

---

## Out of scope (intentionally deferred — it's an internal tool)

- **Custom domain** — the `*.vercel.app` URL is fine for an internal audience.
- **Mobile app** — the responsive web UI covers occasional mobile use.
- **Analytics dashboards** — CSV export + the admin tables are enough for now.
- **SSO beyond Google** — the whole team is on Google; no other IdP needed.
- **Internationalization (i18n)** — single-language internal team.
- **Multi-tenant** — one organization only; no tenant isolation required.
