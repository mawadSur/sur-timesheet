"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revokeTailscaleAccess } from "@/lib/tailscale";
import { revokeDiscordChannelAccess } from "@/lib/discord";

type Supa = Awaited<ReturnType<typeof requireAdmin>>["supabase"];

// Best-effort: strip the user's Tailscale/Discord access for every project they
// were assigned to. Mirrors deprovisionAccess in app/actions.ts (which owns the
// assign/unassign paths). Fully wrapped so a provisioning failure never blocks
// the revoke; each underlying call no-ops when its integration env vars are unset.
async function deprovisionRevokedUser(supabase: Supa, email: string): Promise<void> {
  try {
    const { data: prof } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    const profileId = (prof as { id?: string } | null)?.id;
    if (!profileId) return;

    const { data: rows } = await supabase
      .from("assignments")
      .select("project_id")
      .eq("user_id", profileId);
    const projectIds = (rows as Array<{ project_id: string }> | null)?.map((r) => r.project_id) ?? [];
    if (projectIds.length === 0) return;

    const { data: projects } = await supabase
      .from("projects")
      .select("id, tailscale_tag, discord_channel_id")
      .in("id", projectIds);

    // discord_user_id is added by a later migration; read it on its own so a
    // not-yet-migrated column can't block the Tailscale revoke.
    let discordUserId: string | null = null;
    try {
      const { data: d } = await supabase
        .from("profiles")
        .select("discord_user_id")
        .eq("id", profileId)
        .maybeSingle();
      discordUserId = (d as { discord_user_id?: string | null } | null)?.discord_user_id ?? null;
    } catch {
      /* column not present yet — Discord revoke simply skips */
    }

    const list =
      (projects as Array<{ tailscale_tag?: string | null; discord_channel_id?: string | null }> | null) ?? [];
    for (const p of list) {
      await revokeTailscaleAccess({ email, tag: p.tailscale_tag ?? null });
      if (p.discord_channel_id && discordUserId) {
        await revokeDiscordChannelAccess({ channelId: p.discord_channel_id, discordUserId });
      }
    }
  } catch (e) {
    console.warn(`[deprovisionRevokedUser] skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Admin: revoke access ───────────────────────────────────────────────────────
export async function revokeUser(formData: FormData) {
  const { supabase } = await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return;

  await supabase.from("allowed_emails").update({ is_active: false }).eq("email", email);
  await supabase.from("profiles").update({ is_active: false }).eq("email", email);

  // Remove network/comms access for the projects they were on (best-effort).
  await deprovisionRevokedUser(supabase, email);

  await logAudit("revoke_user", { target: email });
  revalidatePath("/admin");
}

// ── Admin: restore access ────────────────────────────────────────────────────────
export async function restoreUser(formData: FormData) {
  const { supabase } = await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return;

  await supabase.from("allowed_emails").update({ is_active: true }).eq("email", email);
  await supabase.from("profiles").update({ is_active: true }).eq("email", email);

  await logAudit("restore_user", { target: email });
  revalidatePath("/admin");
}

// ── Admin: hard-delete an account (offboarding) ──────────────────────────────────
// Stronger than revokeUser. Permanently removes the auth user — their profile,
// timesheets, and assignments cascade away via ON DELETE CASCADE — and clears the
// allowlist row so they can't silently re-register. Deleting an auth user needs
// the service-role client, which bypasses RLS; if SUPABASE_SERVICE_ROLE_KEY isn't
// configured this no-ops rather than throwing (mirrors the optional-service pattern).
export async function deleteUserAccount(formData: FormData) {
  const { supabase } = await requireAdmin();

  // profileId equals the auth.users id (profiles.id references auth.users.id).
  const authUserId = String(formData.get("profileId") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!authUserId || !email) return;

  // Never let an admin delete their own account.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user?.id === authUserId) return;

  const admin = createAdminClient();
  if (!admin) return;

  const { error } = await admin.auth.admin.deleteUser(authUserId);

  // Clear the allowlist row so the person can't sign up again. Runs regardless of
  // the auth-delete result so a stale allowlist entry never lingers.
  await supabase.from("allowed_emails").delete().eq("email", email);

  await logAudit("delete_user", {
    target: email,
    metadata: {
      auth_user_id: authUserId,
      auth_delete_error: error?.message ?? null,
    },
  });
  revalidatePath("/admin");
}
