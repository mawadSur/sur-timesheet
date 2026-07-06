"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") throw new Error("Admins only.");
  return { supabase, user };
}

export async function addRescueTimeRule(formData: FormData) {
  const { supabase } = await requireAdmin();
  const keyword = String(formData.get("keyword") || "").trim().slice(0, 200);
  const project_id = String(formData.get("project_id") || "");
  if (!keyword || !project_id) return;
  await supabase.from("rescuetime_rules").insert({ keyword, project_id });
  await logAudit("add_rescuetime_rule", { target: keyword, metadata: { project_id } });
  revalidatePath("/admin/rescuetime");
}

export async function deleteRescueTimeRule(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  await supabase.from("rescuetime_rules").delete().eq("id", id);
  revalidatePath("/admin/rescuetime");
}

// Log the RescueTime-suggested hours into the admin's own timesheet for a date.
// Entries arrive as repeated "entry" fields shaped "project_id:hours". RLS still
// enforces that you can only log against projects you're assigned to.
export async function logRescueTimeHours(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const date = String(formData.get("date") || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

  const rows = formData
    .getAll("entry")
    .map((e) => {
      const s = String(e);
      const sep = s.indexOf(":");
      if (sep < 0) return null;
      const project_id = s.slice(0, sep);
      const hours = Number(s.slice(sep + 1));
      return { user_id: user.id, project_id, work_date: date, hours, notes: "via RescueTime" };
    })
    .filter(
      (r): r is { user_id: string; project_id: string; work_date: string; hours: number; notes: string } =>
        !!r && !!r.project_id && Number.isFinite(r.hours) && r.hours > 0 && r.hours <= 24
    );

  if (rows.length === 0) return;
  await supabase.from("timesheets").insert(rows);
  await logAudit("log_rescuetime_hours", { metadata: { date, count: rows.length } });
  revalidatePath("/admin/rescuetime");
  revalidatePath("/");
}
