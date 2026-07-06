"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
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

// ── Admin: create a credential ─────────────────────────────────────────────────
export async function addCredential(formData: FormData) {
  const supabase = await requireAdmin();
  const project_id = String(formData.get("project_id") || "");
  const label = String(formData.get("label") || "").trim();
  const username = String(formData.get("username") || "").trim();
  const secret = String(formData.get("secret") || "");
  const url = String(formData.get("url") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  if (!project_id || !label || !secret) return;

  await supabase.from("credentials").insert({
    project_id,
    label,
    username: username || null,
    secret_encrypted: encryptSecret(secret),
    url: url || null,
    notes: notes || null,
  });

  await logAudit("create_credential", { target: label, metadata: { project_id } });
  revalidatePath("/admin");
}

// ── Admin: update a credential ──────────────────────────────────────────────────
export async function updateCredential(formData: FormData) {
  const supabase = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;

  const label = String(formData.get("label") || "").trim();
  const username = String(formData.get("username") || "").trim();
  const secret = String(formData.get("secret") || "");
  const url = String(formData.get("url") || "").trim();
  const notes = String(formData.get("notes") || "").trim();

  const update: Record<string, unknown> = {
    label: label || null,
    username: username || null,
    url: url || null,
    notes: notes || null,
    updated_at: new Date().toISOString(),
  };
  // Only rotate the stored secret when a new, non-empty one is provided.
  if (secret) update.secret_encrypted = encryptSecret(secret);

  await supabase.from("credentials").update(update).eq("id", id);

  await logAudit("update_credential", { target: label });
  revalidatePath("/admin");
}

// ── Admin: delete a credential ──────────────────────────────────────────────────
export async function deleteCredential(formData: FormData) {
  const supabase = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;

  await supabase.from("credentials").delete().eq("id", id);

  await logAudit("delete_credential", { target: id });
  revalidatePath("/admin");
}

// ── Admin OR assigned user: reveal a project's credentials (plaintext) ──────────
type RevealedCredential = {
  id: string;
  label: string;
  username: string | null;
  secret: string;
  url: string | null;
  notes: string | null;
};

type GetProjectCredentialsResult =
  | {
      ok: true;
      credentials: RevealedCredential[];
      vmHost: string | null;
      pikvmHost: string | null;
    }
  | { ok: false; error: string };

export async function getProjectCredentials(
  projectId: string
): Promise<GetProjectCredentialsResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authorized." };
  if (!projectId) return { ok: false, error: "Not authorized." };

  // Authorized if admin, OR assigned to this project.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Staff are blocked from the vault even on projects they're assigned to.
  if (profile?.role === "staff") return { ok: false, error: "Not authorized." };

  let authorized = profile?.role === "admin";
  if (!authorized) {
    const { data: assignment } = await supabase
      .from("assignments")
      .select("id")
      .eq("user_id", user.id)
      .eq("project_id", projectId)
      .maybeSingle();
    authorized = Boolean(assignment);
  }
  if (!authorized) return { ok: false, error: "Not authorized." };

  // RLS also enforces row visibility here.
  const { data: rows } = await supabase
    .from("credentials")
    .select("id, label, username, secret_encrypted, url, notes")
    .eq("project_id", projectId)
    .order("label");

  const credentials: RevealedCredential[] = (rows ?? []).map((r) => {
    let secret = "";
    try {
      secret = decryptSecret(r.secret_encrypted);
    } catch {
      // One unreadable row must not break the whole reveal.
      secret = "⚠ could not decrypt";
    }
    return {
      id: r.id,
      label: r.label,
      username: r.username,
      secret,
      url: r.url,
      notes: r.notes,
    };
  });

  const { data: project } = await supabase
    .from("projects")
    .select("name, vm_host, pikvm_host")
    .eq("id", projectId)
    .single();

  await logAudit("view_credential", {
    target: project?.name ?? projectId,
    metadata: { project_id: projectId },
  });

  return {
    ok: true,
    credentials,
    vmHost: project?.vm_host ?? null,
    pikvmHost: project?.pikvm_host ?? null,
  };
}
