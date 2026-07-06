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

// Set/correct a person's display name (e.g. to tell apart two accounts whose
// Google display name is identical). RLS `profiles_update_admin` is the backstop.
export async function setProfileName(formData: FormData) {
  const supabase = await requireAdmin();
  const id = String(formData.get("id") || "");
  const full_name = String(formData.get("full_name") || "").trim().slice(0, 120);
  if (!id) return;
  await supabase.from("profiles").update({ full_name: full_name || null }).eq("id", id);
  await logAudit("set_profile_name", { target: id, metadata: { full_name: full_name || null } });
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

// ── Admin: per-assignment billing rates (money is admin-only) ────────────────────
// bill_rate = what the client pays/hour; pay_rate = what we pay the consultant/hour.
// A blank field is an intentional clear (-> null). An invalid entry (negative /
// NaN / absurd) is NOT written at all, so a fat-fingered value can't silently
// wipe a previously-saved valid rate — the prior value is preserved on upsert.
function parseRateField(v: FormDataEntryValue | null): { present: boolean; value: number | null } {
  const s = String(v ?? "").trim();
  if (s === "") return { present: true, value: null }; // intentional clear
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return { present: false, value: null }; // invalid -> omit
  return { present: true, value: Math.round(n * 100) / 100 };
}

export async function setAssignmentRate(formData: FormData) {
  const supabase = await requireAdmin();
  const assignment_id = String(formData.get("assignment_id") || "");
  if (!assignment_id) return;
  const bill = parseRateField(formData.get("bill_rate"));
  const pay = parseRateField(formData.get("pay_rate"));
  const payload: Record<string, unknown> = {
    assignment_id,
    updated_at: new Date().toISOString(),
  };
  // Omit an invalid field so ON CONFLICT DO UPDATE leaves the prior value intact.
  if (bill.present) payload.bill_rate = bill.value;
  if (pay.present) payload.pay_rate = pay.value;
  await supabase.from("assignment_rates").upsert(payload, { onConflict: "assignment_id" });
  await logAudit("set_rate", {
    target: assignment_id,
    metadata: { bill_rate: bill.present ? bill.value : undefined, pay_rate: pay.present ? pay.value : undefined },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/books");
}
