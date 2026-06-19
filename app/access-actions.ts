"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

// ── Auth helper ──────────────────────────────────────────────────────────────
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("Admins only.");
  return supabase;
}

// ── Admin: revoke access ───────────────────────────────────────────────────────
export async function revokeUser(formData: FormData) {
  const supabase = await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return;

  await supabase.from("allowed_emails").update({ is_active: false }).eq("email", email);
  await supabase.from("profiles").update({ is_active: false }).eq("email", email);

  await logAudit("revoke_user", { target: email });
  revalidatePath("/admin");
}

// ── Admin: restore access ────────────────────────────────────────────────────────
export async function restoreUser(formData: FormData) {
  const supabase = await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return;

  await supabase.from("allowed_emails").update({ is_active: true }).eq("email", email);
  await supabase.from("profiles").update({ is_active: true }).eq("email", email);

  await logAudit("restore_user", { target: email });
  revalidatePath("/admin");
}
