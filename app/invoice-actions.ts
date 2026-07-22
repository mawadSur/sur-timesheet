"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  resolveMonthWindow,
  buildRateHistoryByPair,
  billableInvoiceLines,
  fetchAllRows,
} from "@/lib/books";

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Compute a project's billable lines for a period from the live timesheets.
async function computeBillable(supabase: any, projectId: string, start: string, end: string) {
  const [rows, { data: assignments }, { data: rates }] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("timesheets")
        .select("work_date, user_id, project_id, hours, profiles(full_name, email)")
        .eq("project_id", projectId)
        .gte("work_date", start)
        .lte("work_date", end)
        .order("id")
        .range(from, to)
    ),
    supabase.from("assignments").select("id, user_id, project_id").eq("project_id", projectId),
    supabase.from("assignment_rates").select("assignment_id, bill_rate, pay_rate, effective_from"),
  ]);
  const rateHistory = buildRateHistoryByPair(assignments, rates);
  const lines = billableInvoiceLines(rows, rateHistory);
  const subtotal_cents = lines.reduce((s, l) => s + l.amount_cents, 0);
  return { lines, subtotal_cents };
}

// Create (or open) a draft invoice for a project × month.
export async function generateInvoice(formData: FormData) {
  const { supabase } = await requireAdmin();
  const project_id = String(formData.get("project_id") || "");
  const month = String(formData.get("month") || "");
  if (!project_id) return;
  const { start, end } = resolveMonthWindow(month);

  const { data: existing } = await supabase
    .from("invoices")
    .select("id")
    .eq("project_id", project_id)
    .eq("period_start", start)
    .eq("period_end", end)
    .maybeSingle();
  if (existing?.id) redirect(`/admin/invoices/${existing.id}`);

  // Billing defaults live in the admin-only project_billing table (a project
  // row is readable by staff, so it carries no money). The row is optional —
  // a project that never set a bill-to simply has none.
  const { data: billing } = await supabase
    .from("project_billing")
    .select("bill_to")
    .eq("project_id", project_id)
    .maybeSingle();
  const { subtotal_cents } = await computeBillable(supabase, project_id, start, end);

  const { data: inserted } = await supabase
    .from("invoices")
    .insert({
      project_id,
      period_start: start,
      period_end: end,
      status: "draft",
      subtotal_cents,
      total_cents: subtotal_cents,
      bill_to: billing?.bill_to ?? null,
    })
    .select("id")
    .single();

  await logAudit("generate_invoice", { target: inserted?.id, metadata: { project_id, month } });
  revalidatePath("/admin/invoices");
  if (inserted?.id) redirect(`/admin/invoices/${inserted.id}`);
}

// Refresh a draft's preview total from current timesheets.
export async function regenerateInvoice(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const { data: inv } = await supabase
    .from("invoices")
    .select("project_id, period_start, period_end, status, adjustment_cents")
    .eq("id", id)
    .single();
  if (!inv || inv.status !== "draft") return;
  const { subtotal_cents } = await computeBillable(supabase, inv.project_id, inv.period_start, inv.period_end);
  await supabase
    .from("invoices")
    .update({
      subtotal_cents,
      total_cents: subtotal_cents + Number(inv.adjustment_cents || 0),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  revalidatePath(`/admin/invoices/${id}`);
}

// Freeze the snapshot lines and mark the invoice sent.
export async function sendInvoice(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const { data: inv } = await supabase
    .from("invoices")
    .select("project_id, period_start, period_end, status, adjustment_cents")
    .eq("id", id)
    .single();
  if (!inv || inv.status !== "draft") return;

  const [{ lines, subtotal_cents }, { data: billing }] = await Promise.all([
    computeBillable(supabase, inv.project_id, inv.period_start, inv.period_end),
    supabase
      .from("project_billing")
      .select("payment_terms_days, bill_to")
      .eq("project_id", inv.project_id)
      .maybeSingle(),
  ]);

  const { data: number } = await supabase.rpc("next_invoice_number");
  const today = new Date();
  const due = new Date(today);
  due.setDate(due.getDate() + Number(billing?.payment_terms_days ?? 30));

  // Freeze the line snapshot.
  await supabase.from("invoice_lines").delete().eq("invoice_id", id); // idempotent re-send guard
  if (lines.length > 0) {
    await supabase.from("invoice_lines").insert(
      lines.map((l) => ({
        invoice_id: id,
        user_id: l.user_id,
        description: `${l.name} — ${l.hours} h @ $${l.bill_rate.toFixed(2)}/h`,
        hours: l.hours,
        bill_rate: l.bill_rate,
        amount_cents: l.amount_cents,
      }))
    );
  }

  await supabase
    .from("invoices")
    .update({
      invoice_number: number,
      status: "sent",
      issued_on: iso(today),
      due_on: iso(due),
      subtotal_cents,
      total_cents: subtotal_cents + Number(inv.adjustment_cents || 0),
      bill_to: billing?.bill_to ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  await logAudit("send_invoice", { target: number ?? id, metadata: { total_cents: subtotal_cents } });
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
}

export async function markInvoicePaid(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const { data: inv } = await supabase.from("invoices").select("total_cents, status").eq("id", id).single();
  if (!inv || inv.status !== "sent") return; // only a sent invoice can be paid; paid/void are terminal
  const paidField = String(formData.get("paid_on") || "").trim();
  const paid_on = /^\d{4}-\d{2}-\d{2}$/.test(paidField) ? paidField : iso(new Date());
  const recvField = String(formData.get("amount_received") || "").trim();
  const total_cents = Number(inv.total_cents || 0);
  const amount_received_cents =
    recvField !== "" && Number.isFinite(Number(recvField))
      ? Math.max(0, Math.round(Number(recvField) * 100))
      : total_cents;
  // Full payment (>= total) closes the invoice as 'paid'; a partial payment stays
  // 'sent' (still outstanding for AR aging) while recording what's been received.
  const status = amount_received_cents >= total_cents ? "paid" : "sent";
  await supabase
    .from("invoices")
    .update({ status, paid_on, amount_received_cents, updated_at: new Date().toISOString() })
    .eq("id", id);
  await logAudit("pay_invoice", { target: id, metadata: { amount_received_cents, status } });
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
}

export async function voidInvoice(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const { data: inv } = await supabase.from("invoices").select("status").eq("id", id).single();
  // Only a sent invoice can be voided: drafts are deleted, and paid/void are terminal.
  if (!inv || inv.status !== "sent") return;
  await supabase
    .from("invoices")
    .update({ status: "void", updated_at: new Date().toISOString() })
    .eq("id", id);
  await logAudit("void_invoice", { target: id });
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
}

// Edit adjustment / notes / bill-to (keeps total = subtotal + adjustment).
export async function updateInvoice(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const { data: inv } = await supabase.from("invoices").select("subtotal_cents, status").eq("id", id).single();
  if (!inv || inv.status === "void" || inv.status === "paid") return;
  const adjField = String(formData.get("adjustment") || "").trim();
  const adjustment_cents =
    adjField !== "" && Number.isFinite(Number(adjField)) ? Math.round(Number(adjField) * 100) : 0;
  const bill_to = String(formData.get("bill_to") || "").trim() || null;
  const notes = String(formData.get("notes") || "").trim().slice(0, 2000) || null;
  await supabase
    .from("invoices")
    .update({
      adjustment_cents,
      total_cents: Number(inv.subtotal_cents || 0) + adjustment_cents,
      bill_to,
      notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  await logAudit("update_invoice", { target: id });
  revalidatePath(`/admin/invoices/${id}`);
}

export async function deleteInvoice(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const { data: inv } = await supabase.from("invoices").select("status").eq("id", id).single();
  if (!inv || inv.status !== "draft") return; // only drafts are deletable
  await supabase.from("invoices").delete().eq("id", id);
  await logAudit("delete_invoice", { target: id });
  revalidatePath("/admin/invoices");
  redirect("/admin/invoices");
}
