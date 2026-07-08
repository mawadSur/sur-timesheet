"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

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
//
// Timesheets are intentionally append-only (no DB unique constraint), so this
// action carries a SOFT dedup guard: if the user already has any hours logged
// for a project on this date, we skip that project rather than silently
// double-counting into Books/invoices, and surface a notice on the page.
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

  // Soft dedup: which of these projects already have hours logged this date?
  const projectIds = [...new Set(rows.map((r) => r.project_id))];
  const { data: existing } = await supabase
    .from("timesheets")
    .select("project_id, hours, projects(name)")
    .eq("user_id", user.id)
    .eq("work_date", date)
    .in("project_id", projectIds);

  const alreadyLogged = new Map<string, { name: string; hours: number }>();
  for (const e of (existing ?? []) as any[]) {
    const name = Array.isArray(e.projects) ? e.projects[0]?.name : e.projects?.name;
    const prev = alreadyLogged.get(e.project_id) ?? { name: name ?? "project", hours: 0 };
    prev.hours += Number(e.hours) || 0;
    if (name) prev.name = name;
    alreadyLogged.set(e.project_id, prev);
  }

  const toInsert = rows.filter((r) => !alreadyLogged.has(r.project_id));

  if (toInsert.length > 0) {
    await supabase.from("timesheets").insert(toInsert);
    await logAudit("log_rescuetime_hours", { metadata: { date, count: toInsert.length } });
  }

  const params = new URLSearchParams({ day: date });
  if (toInsert.length > 0) params.set("logged", String(toInsert.length));
  if (alreadyLogged.size > 0) {
    const desc = [...alreadyLogged.values()]
      .map((p) => `${p.name} (${p.hours} h)`)
      .join(", ")
      .slice(0, 300);
    params.set("skipped", desc);
  }

  revalidatePath("/admin/rescuetime");
  revalidatePath("/");
  redirect(`/admin/rescuetime?${params.toString()}`);
}
