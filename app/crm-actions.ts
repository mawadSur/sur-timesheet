"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { dollarsToCents } from "@/lib/books";
import { asPipelineStage, asPayType } from "@/lib/crm";

// CRM / pipeline edits on a project (the opportunity lives ON the project — see
// supabase/schema.sql PHASE 9). Admin-only. Kept separate from updateProject so
// the sales fields and the operational metadata each have their own small form.

const iso = /^\d{4}-\d{2}-\d{2}$/;

function s(formData: FormData, key: string, max = 200): string | null {
  const v = String(formData.get(key) || "").trim().slice(0, max);
  return v || null;
}

// ── Save an opportunity's CRM fields ────────────────────────────────────────────
export async function updateOpportunity(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;

  const nextField = String(formData.get("next_step_on") || "").trim();

  // Employment type re-uses the project's pay_type column (C2C / W2 / 1099) and
  // stays on the (employee-readable) projects row — it's operational metadata.
  await supabase
    .from("projects")
    .update({ pay_type: asPayType(s(formData, "pay_type") ?? undefined) })
    .eq("id", id);

  // Candidate PII + hourly rate + pipeline live in the admin-only project_crm
  // table (never exposed to assigned employees). A blank stage just leaves the
  // row with pipeline_stage = null, which drops it off the CRM board.
  await supabase.from("project_crm").upsert(
    {
      project_id: id,
      pipeline_stage: asPipelineStage(s(formData, "pipeline_stage") ?? undefined),
      contact_name: s(formData, "contact_name", 120),
      contact_email: s(formData, "contact_email", 200),
      contact_phone: s(formData, "contact_phone", 60),
      next_step: s(formData, "next_step", 300),
      next_step_on: iso.test(nextField) ? nextField : null,
      // Blank / invalid rate clears it (dollarsToCents -> null). Integer cents.
      estimated_value_cents: dollarsToCents(formData.get("estimated_value")),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  );
  await logAudit("update_opportunity", {
    target: id,
    metadata: { pipeline_stage: s(formData, "pipeline_stage") ?? null },
  });
  revalidatePath("/admin/crm");
  revalidatePath("/admin/dashboard");
  revalidatePath(`/admin/projects/${id}`);
}
