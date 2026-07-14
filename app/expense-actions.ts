"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { dollarsToCents } from "@/lib/books";

// Per-project expense ledger actions. Admin-only (money is admin-only, like
// invoices / rates). Amounts are parsed to integer cents; the audit log records
// ids + cents only — never anything sensitive.

const iso = /^\d{4}-\d{2}-\d{2}$/;

function s(formData: FormData, key: string, max = 200): string | null {
  const v = String(formData.get(key) || "").trim().slice(0, max);
  return v || null;
}

export type ExpenseRow = {
  id: string;
  project_id: string;
  spent_on: string;
  amount_cents: number;
  category: string | null;
  vendor: string | null;
  description: string | null;
  created_at: string;
};

// ── Add an expense to a project's ledger ────────────────────────────────────────
export async function addExpense(formData: FormData) {
  const { supabase, user } = await requireAdmin();
  const project_id = String(formData.get("project_id") || "");
  const amount_cents = dollarsToCents(formData.get("amount"));
  const spentField = String(formData.get("spent_on") || "").trim();
  const spent_on = iso.test(spentField) ? spentField : new Date().toISOString().slice(0, 10);
  // Require a project and a valid, positive amount — a $0 / blank expense is noise.
  if (!project_id || amount_cents == null || amount_cents <= 0) return;

  await supabase.from("expenses").insert({
    project_id,
    spent_on,
    amount_cents,
    category: s(formData, "category", 60),
    vendor: s(formData, "vendor", 120),
    description: s(formData, "description", 500),
    created_by: user.id,
  });
  await logAudit("add_expense", { target: project_id, metadata: { amount_cents } });
  revalidatePath(`/admin/projects/${project_id}`);
  revalidatePath("/admin/books");
}

// ── Delete an expense ───────────────────────────────────────────────────────────
export async function deleteExpense(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  const project_id = String(formData.get("project_id") || "");
  if (!id) return;
  await supabase.from("expenses").delete().eq("id", id);
  await logAudit("delete_expense", { target: id });
  if (project_id) revalidatePath(`/admin/projects/${project_id}`);
  revalidatePath("/admin/books");
}

// ── Read a project's expenses (newest first). Relies on RLS (admin-only). ────────
export async function getProjectExpenses(projectId: string): Promise<ExpenseRow[]> {
  if (!projectId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("id, project_id, spent_on, amount_cents, category, vendor, description, created_at")
    .eq("project_id", projectId)
    .order("spent_on", { ascending: false });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id as string,
    project_id: r.project_id as string,
    spent_on: r.spent_on as string,
    amount_cents: Number(r.amount_cents) || 0,
    category: (r.category as string | null) ?? null,
    vendor: (r.vendor as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    created_at: r.created_at as string,
  }));
}
