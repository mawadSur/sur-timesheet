// Best-effort Tailscale provisioning for project assignments.
//
// On assignment we invite the assignee's email into the tailnet; on
// unassign/revoke we remove that access. Requires TAILSCALE_API_KEY and
// TAILSCALE_TAILNET. Like lib/summarize.ts and lib/discord.ts, every function
// no-ops cleanly (logs + returns) when those aren't set, and swallows all
// network errors — provisioning must never break the assign/unassign flow.
//
// NOTE on ACL tags: mapping a project's `tailscale_tag` to concrete device-ACL
// grants (i.e. *which* tagged devices an invited user may reach) requires an
// agreed tag scheme and a tailnet ACL/grants edit. That policy step is called
// out with TODO(tag-scheme) below and intentionally left unimplemented; the
// `tag` argument is accepted now so call sites stay stable once it lands.

const API_BASE = "https://api.tailscale.com/api/v2";
const TIMEOUT_MS = 10000;

export type TailscaleResult = { ok: boolean; skipped?: boolean; error?: string };

function config(): { apiKey: string; tailnet: string } | null {
  const apiKey = process.env.TAILSCALE_API_KEY;
  const tailnet = process.env.TAILSCALE_TAILNET;
  if (!apiKey || !tailnet) return null;
  return { apiKey, tailnet };
}

async function tsFetch(apiKey: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function grantTailscaleAccess({
  email,
  tag,
}: {
  email: string;
  tag?: string | null;
}): Promise<TailscaleResult> {
  const cfg = config();
  if (!cfg) {
    console.info("[tailscale] TAILSCALE_API_KEY/TAILSCALE_TAILNET not set — skipping grant");
    return { ok: false, skipped: true, error: "not configured" };
  }
  if (!email) return { ok: false, skipped: true, error: "no email" };

  try {
    // Invite the user's email into the tailnet (Tailscale user-invites endpoint).
    const res = await tsFetch(
      cfg.apiKey,
      `/tailnet/${encodeURIComponent(cfg.tailnet)}/user-invites`,
      { method: "POST", body: JSON.stringify([{ role: "member", email }]) }
    );
    if (!res.ok) {
      console.warn(`[tailscale] user-invite failed for ${email}: ${res.status}`);
      return { ok: false, error: `Tailscale API ${res.status}` };
    }
    // TODO(tag-scheme): apply the device-ACL grant for `tag` here once the
    // project-tag → tailnet-grant scheme is agreed (PATCH the tailnet ACL/grants
    // so the invited user can reach only the devices carrying this project's tag).
    void tag;
    return { ok: true };
  } catch (e) {
    console.warn(`[tailscale] grant error for ${email}: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function revokeTailscaleAccess({
  email,
  tag,
}: {
  email: string;
  tag?: string | null;
}): Promise<TailscaleResult> {
  const cfg = config();
  if (!cfg) {
    console.info("[tailscale] TAILSCALE_API_KEY/TAILSCALE_TAILNET not set — skipping revoke");
    return { ok: false, skipped: true, error: "not configured" };
  }
  if (!email) return { ok: false, skipped: true, error: "no email" };

  try {
    // Best-effort: delete any *pending* tailnet invite for this email. (An invite
    // that was already accepted makes the person a full tailnet member; removing
    // that member's device-ACL access is part of the TODO(tag-scheme) work below.)
    const list = await tsFetch(
      cfg.apiKey,
      `/tailnet/${encodeURIComponent(cfg.tailnet)}/user-invites`
    );
    if (list.ok) {
      const invites = (await list.json()) as Array<{
        id?: string;
        email?: string;
        invitedEmail?: string;
      }>;
      const matches = Array.isArray(invites)
        ? invites.filter(
            (i) => (i.email ?? i.invitedEmail ?? "").toLowerCase() === email.toLowerCase()
          )
        : [];
      for (const inv of matches) {
        if (!inv.id) continue;
        await tsFetch(cfg.apiKey, `/user-invites/${encodeURIComponent(inv.id)}`, {
          method: "DELETE",
        });
      }
    } else {
      console.warn(`[tailscale] list user-invites failed: ${list.status}`);
    }
    // TODO(tag-scheme): revoke the device-ACL grant for `tag` (and remove an
    // already-accepted member from the tailnet) once the tag scheme is agreed.
    void tag;
    return { ok: true };
  } catch (e) {
    console.warn(`[tailscale] revoke error for ${email}: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
