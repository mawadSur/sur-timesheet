"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { dollarsToCents } from "@/lib/books";
import { asPipelineStage } from "@/lib/crm";

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
  await supabase
    .from("projects")
    .update({
      // A blank stage clears the opportunity flag (back to a plain project).
      pipeline_stage: asPipelineStage(s(formData, "pipeline_stage") ?? undefined),
      contact_name: s(formData, "contact_name", 120),
      contact_email: s(formData, "contact_email", 200),
      source: s(formData, "source", 120),
      next_step: s(formData, "next_step", 300),
      next_step_on: iso.test(nextField) ? nextField : null,
      // Blank / invalid value clears it (dollarsToCents -> null).
      estimated_value_cents: dollarsToCents(formData.get("estimated_value")),
    })
    .eq("id", id);
  await logAudit("update_opportunity", {
    target: id,
    metadata: { pipeline_stage: s(formData, "pipeline_stage") ?? null },
  });
  revalidatePath("/admin/crm");
  revalidatePath("/admin/dashboard");
  revalidatePath(`/admin/projects/${id}`);
}
