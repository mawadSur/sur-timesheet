"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { buildRateHistoryByPair, fetchAllRows } from "@/lib/books";
import { resolvePayPeriod, payrollByContractor } from "@/lib/payroll";

const iso = (d: Date) => d.toISOString().slice(0, 10);

// A real calendar date (rejects a well-formed-but-impossible value like 2026-13-45
// that would otherwise fail the Postgres date cast and silently drop the update).
const isRealDate = (s: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

// Compute a pay period's contractor breakdown from the LIVE data — exactly the
// same pipeline as /admin/payroll (buildRateHistoryByPair + payrollByContractor).
async function computePayroll(supabase: any, start: string, end: string) {
  const [timesheets, { data: assignments }, { data: rates }] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("timesheets")
        .select("work_date, user_id, project_id, hours, profiles(full_name, email), projects(name)")
        .gte("work_date", start)
        .lte("work_date", end)
        .order("id")
        .range(from, to)
    ),
    supabase.from("assignments").select("id, user_id, project_id"),
    supabase.from("assignment_rates").select("assignment_id, bill_rate, pay_rate, effective_from"),
  ]);
  const rateHistory = buildRateHistoryByPair(assignments, rates);
  return payrollByContractor(timesheets, rateHistory);
}

// Flatten payroll rows into payroll_run_lines rows for a given run.
function linesForRun(run_id: string, rows: Awaited<ReturnType<typeof computePayroll>>) {
  const out: any[] = [];
  for (const row of rows) {
    for (const line of row.projects) {
      out.push({
        run_id,
        user_id: row.user_id,
        user_name: row.name,
        project_id: line.project_id,
        project_name: line.project_name,
        hours: line.hours,
        pay_rate: line.pay_rate,
        amount_cents: line.amount_cents,
      });
    }
  }
  return out;
}

// Create (or open) a draft payroll run for a pay period, freezing the breakdown.
export async function createPayrollRun(formData: FormData) {
  const { supabase } = await requireAdmin();
  const period_key = String(formData.get("period_key") || "");
  const period = resolvePayPeriod(period_key);

  const { data: existing } = await supabase
    .from("payroll_runs")
    .select("id")
    .eq("period_key", period.key)
    .maybeSingle();
  if (existing?.id) redirect(`/admin/payroll/runs/${existing.id}`);

  const rows = await computePayroll(supabase, period.start, period.end);
  const total_cents = rows.reduce((s, r) => s + r.amount_cents, 0);

  const { data: inserted } = await supabase
    .from("payroll_runs")
    .insert({
      period_key: period.key,
      period_start: period.start,
      period_end: period.end,
      status: "draft",
      total_cents,
    })
    .select("id")
    .single();

  // A concurrent finalize (or an already-existing run) trips the
  // unique(period_key) constraint; recover by opening the run that won the race
  // rather than silently doing nothing.
  if (!inserted?.id) {
    const { data: race } = await supabase
      .from("payroll_runs")
      .select("id")
      .eq("period_key", period.key)
      .maybeSingle();
    if (race?.id) redirect(`/admin/payroll/runs/${race.id}`);
    return;
  }

  const lines = linesForRun(inserted.id, rows);
  if (lines.length > 0) await supabase.from("payroll_run_lines").insert(lines);

  await logAudit("create_payroll_run", { target: inserted.id, metadata: { period_key: period.key, total_cents } });
  revalidatePath("/admin/payroll/runs");
  redirect(`/admin/payroll/runs/${inserted.id}`);
}

// Refresh a draft run's frozen lines + total from current live data.
export async function regeneratePayrollRun(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const { data: run } = await supabase
    .from("payroll_runs")
    .select("status, period_start, period_end")
    .eq("id", id)
    .single();
  if (!run || run.status !== "draft") return;

  await supabase.from("payroll_run_lines").delete().eq("run_id", id);
  const rows = await computePayroll(supabase, run.period_start, run.period_end);
  const total_cents = rows.reduce((s, r) => s + r.amount_cents, 0);
  const lines = linesForRun(id, rows);
  if (lines.length > 0) await supabase.from("payroll_run_lines").insert(lines);

  await supabase
    .from("payroll_runs")
    .update({ total_cents, updated_at: new Date().toISOString() })
    .eq("id", id);
  await logAudit("regenerate_payroll_run", { target: id, metadata: { total_cents } });
  revalidatePath(`/admin/payroll/runs/${id}`);
}

// Mark a draft run paid (the record of what was actually paid out).
export async function markPayrollRunPaid(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const { data: run } = await supabase.from("payroll_runs").select("status").eq("id", id).single();
  if (!run || run.status !== "draft") return; // only a draft can be paid
  const paidField = String(formData.get("paid_on") || "").trim();
  const paid_on = isRealDate(paidField) ? paidField : iso(new Date());
  await supabase
    .from("payroll_runs")
    .update({ status: "paid", paid_on, updated_at: new Date().toISOString() })
    .eq("id", id);
  await logAudit("pay_payroll_run", { target: id, metadata: { paid_on } });
  revalidatePath("/admin/payroll/runs");
  revalidatePath(`/admin/payroll/runs/${id}`);
}

// Void a paid run (reverses the record; drafts are deleted instead).
export async function voidPayrollRun(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const { data: run } = await supabase.from("payroll_runs").select("status").eq("id", id).single();
  if (!run || run.status !== "paid") return; // only a paid run can be voided
  await supabase
    .from("payroll_runs")
    .update({ status: "void", updated_at: new Date().toISOString() })
    .eq("id", id);
  await logAudit("void_payroll_run", { target: id });
  revalidatePath("/admin/payroll/runs");
  revalidatePath(`/admin/payroll/runs/${id}`);
}

export async function deletePayrollRun(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  const { data: run } = await supabase.from("payroll_runs").select("status").eq("id", id).single();
  // Drafts and VOID runs are deletable (lines cascade). Allowing void deletion is
  // what frees a mistakenly-voided period so it can be finalized again — the
  // unique(period_key) constraint would otherwise strand it forever.
  if (!run || (run.status !== "draft" && run.status !== "void")) return;
  await supabase.from("payroll_runs").delete().eq("id", id);
  await logAudit("delete_payroll_run", { target: id, metadata: { status: run.status } });
  revalidatePath("/admin/payroll/runs");
  redirect("/admin/payroll/runs");
}
