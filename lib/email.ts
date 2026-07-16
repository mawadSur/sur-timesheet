// Best-effort transactional email via Resend's REST API. Feature-gated on
// RESEND_API_KEY + INVITE_FROM_EMAIL; no-ops cleanly (logs + returns) when either
// is unset, and swallows every network error so a mail failure can never break
// the admin action that triggered it — same contract as lib/tailscale.ts and
// lib/discord.ts. No SDK: a single fetch, matching the app's other integrations.

import { BRAND } from "@/config/timesheet";

const RESEND_API = "https://api.resend.com/emails";
const TIMEOUT_MS = 10000;

// Escape values interpolated into the HTML body. `to` is admin-entered and only
// shape-validated upstream, so neutralize HTML metacharacters defensively.
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export type EmailResult = { ok: boolean; skipped?: boolean; error?: string };

// The public URL new hires are pointed at. Overridable via NEXT_PUBLIC_SITE_URL;
// defaults to the known production host. Trailing slashes trimmed.
function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://sur-timesheet.vercel.app").replace(/\/+$/, "");
}

function config(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.INVITE_FROM_EMAIL;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

// Notify a newly-allowlisted person that they can now sign in. Google OAuth is
// the gate, so this is a plain notification — no token/magic link to leak.
export async function sendInviteEmail({ to }: { to: string }): Promise<EmailResult> {
  const cfg = config();
  if (!cfg) {
    console.info("[email] RESEND_API_KEY/INVITE_FROM_EMAIL not set — skipping invite email");
    return { ok: false, skipped: true, error: "not configured" };
  }
  if (!to) return { ok: false, skipped: true, error: "no recipient" };

  const loginUrl = `${siteUrl()}/login`;
  const brand = BRAND.name;
  const subject = `You've been invited to ${brand}`;
  const text =
    `You've been added to ${brand}${BRAND.tagline ? ` — ${BRAND.tagline}` : ""}.\n\n` +
    `Sign in with your Google account (${to}) here:\n${loginUrl}\n\n` +
    `Access is invite-only, so sign in with this exact email address.`;
  const html =
    `<p>You've been added to <strong>${brand}</strong>${BRAND.tagline ? ` — ${BRAND.tagline}` : ""}.</p>` +
    `<p><a href="${esc(loginUrl)}">Sign in with your Google account</a> (${esc(to)}).</p>` +
    `<p style="color:#5b6470;font-size:13px">Access is invite-only, so sign in with this exact email address.</p>`;

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: cfg.from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[email] invite send failed for ${to}: ${res.status}`);
      return { ok: false, error: `Resend API ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.warn(`[email] invite error for ${to}: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
