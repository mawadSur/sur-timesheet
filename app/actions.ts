"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

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

// ── Employee: submit a timesheet ────────────────────────────────────────────────
type SubmitPayload = {
  date: string;
  entries: { projectId: string; hours: number; notes: string }[];
};

export async function submitTimesheet(payload: SubmitPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — please sign in again." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    return { ok: false, error: "Invalid date." };
  }

  const rows = (payload.entries || [])
    .map((e) => ({
      user_id: user.id,
      project_id: e.projectId,
      work_date: payload.date,
      hours: Number(e.hours),
      notes: (e.notes || "").slice(0, 500),
    }))
    .filter(
      (r) =>
        r.project_id &&
        Number.isFinite(r.hours) &&
        r.hours > 0 &&
        r.hours <= 24
    );

  if (rows.length === 0) {
    return { ok: false, error: "Add at least one project with hours." };
  }

  const { error } = await supabase.from("timesheets").insert(rows);
  if (error) {
    return {
      ok: false,
      error:
        "Could not save. You can only log hours for projects you're assigned to.",
    };
  }
  revalidatePath("/");
  return { ok: true, rows: rows.length };
}

// ── Admin: allowed emails / roles ────────────────────────────────────────────────
export async function addAllowedEmail(formData: FormData) {
  const supabase = await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "employee");
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
  await supabase
    .from("allowed_emails")
    .upsert({ email, role: role === "admin" ? "admin" : "employee" });
  await logAudit("add_allowed_email", { target: email });
  revalidatePath("/admin");
}

export async function removeAllowedEmail(formData: FormData) {
  const supabase = await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return;
  await supabase.from("allowed_emails").delete().eq("email", email);
  await logAudit("remove_allowed_email", { target: email });
  revalidatePath("/admin");
}

export async function setRole(formData: FormData) {
  const supabase = await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "employee") === "admin" ? "admin" : "employee";
  if (!email) return;
  await supabase.from("allowed_emails").update({ role }).eq("email", email);
  await supabase.from("profiles").update({ role }).eq("email", email);
  await logAudit("set_role", { target: email, metadata: { role } });
  revalidatePath("/admin");
}

// ── Admin: projects ──────────────────────────────────────────────────────────────
export async function createProject(formData: FormData) {
  const supabase = await requireAdmin();
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  await supabase.from("projects").insert({
    name,
    description: String(formData.get("description") || "").trim() || null,
    starts_on: String(formData.get("starts_on") || "") || null,
    ends_on: String(formData.get("ends_on") || "") || null,
    vm_host: String(formData.get("vm_host") || "").trim() || null,
  });
  await logAudit("create_project", { target: name });
  revalidatePath("/admin");
}

export async function deleteProject(formData: FormData) {
  const supabase = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  await supabase.from("projects").delete().eq("id", id);
  await logAudit("delete_project", { target: id });
  revalidatePath("/admin");
}

// ── Admin: assignments ───────────────────────────────────────────────────────────
export async function assignProject(formData: FormData) {
  const supabase = await requireAdmin();
  const user_id = String(formData.get("user_id") || "");
  const project_id = String(formData.get("project_id") || "");
  if (!user_id || !project_id) return;
  await supabase
    .from("assignments")
    .upsert({ user_id, project_id }, { onConflict: "user_id,project_id" });
  await logAudit("assign", { metadata: { user_id, project_id } });
  revalidatePath("/admin");
}

export async function unassignProject(formData: FormData) {
  const supabase = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  await supabase.from("assignments").delete().eq("id", id);
  await logAudit("unassign", { target: id });
  revalidatePath("/admin");
}
