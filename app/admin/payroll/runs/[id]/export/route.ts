import { createClient } from "@/lib/supabase/server";
import { csvCell } from "@/lib/csv";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function periodLabel(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sd}–${ed}, ${sy}`;
  return `${MONTHS[sm - 1]} ${sd}, ${sy} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
}

// CSV of a payroll run's frozen lines, one row per (contractor, project).
// Admin-only (RLS is the backstop; this re-checks the role explicitly).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new Response("Forbidden", { status: 403 });

  const { data: run } = await supabase
    .from("payroll_runs")
    .select("period_key, period_start, period_end, paid_on")
    .eq("id", id)
    .single();
  if (!run) return new Response("Not found", { status: 404 });

  const { data: lineRows } = await supabase
    .from("payroll_run_lines")
    .select("user_name, project_name, hours, pay_rate, amount_cents")
    .eq("run_id", id)
    .order("amount_cents", { ascending: false });

  const label = periodLabel(run.period_start, run.period_end);
  const header = ["Period", "Paid on", "Contractor", "Project", "Hours", "Pay rate", "Amount"];
  const lines = [header.map(csvCell).join(",")];
  for (const l of (lineRows ?? []) as any[]) {
    lines.push(
      [
        label,
        run.paid_on || "",
        l.user_name || "",
        l.project_name || "",
        (Math.round(Number(l.hours) * 100) / 100).toString(),
        l.pay_rate != null ? Number(l.pay_rate).toFixed(2) : "",
        (Number(l.amount_cents || 0) / 100).toFixed(2),
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sur-payroll-run-${run.period_key}.csv"`,
    },
  });
}
