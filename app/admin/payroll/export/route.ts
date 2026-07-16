import { createClient } from "@/lib/supabase/server";
import { csvCell } from "@/lib/csv";
import { buildRateByPair, fetchAllRows } from "@/lib/books";
import { resolvePayPeriod, payrollByContractor } from "@/lib/payroll";

// CSV of a pay period's contractor payouts, one row per (contractor, project).
// Admin-only (RLS is the backstop; this re-checks the role explicitly).
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") return new Response("Forbidden", { status: 403 });

  const period = resolvePayPeriod(new URL(req.url).searchParams.get("period"));

  const [timesheets, { data: assignments }, { data: rates }] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("timesheets")
        .select("user_id, project_id, hours, profiles(full_name, email), projects(name)")
        .gte("work_date", period.start)
        .lte("work_date", period.end)
        .order("id")
        .range(from, to)
    ),
    supabase.from("assignments").select("id, user_id, project_id"),
    supabase.from("assignment_rates").select("assignment_id, bill_rate, pay_rate"),
  ]);

  const rateByPair = buildRateByPair(assignments, rates);
  const rows = payrollByContractor(timesheets, rateByPair);

  const header = ["Pay period", "Pay date", "Contractor", "Email", "Project", "Hours", "Pay rate (USD/hr)", "Amount (USD)"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    for (const l of r.projects) {
      lines.push(
        [
          period.label,
          period.payDate,
          r.name,
          r.email || "",
          l.project_name,
          (Math.round(l.hours * 100) / 100).toString(),
          l.pay_rate != null ? Number(l.pay_rate).toFixed(2) : "",
          l.missingRate ? "" : (l.amount_cents / 100).toFixed(2),
        ]
          .map(csvCell)
          .join(",")
      );
    }
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sur-payroll-${period.key}.csv"`,
    },
  });
}
