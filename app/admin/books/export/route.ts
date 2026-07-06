import { createClient } from "@/lib/supabase/server";
import { csvCell } from "@/lib/csv";
import { resolveMonthWindow, buildRateByPair, lineMoneyCents, fetchAllRows } from "@/lib/books";

// Money-aware timesheet export: hours × per-assignment rates → revenue/cost/margin.
// Admin-only (middleware gates /admin, and we re-check here as defence in depth).
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") return new Response("Forbidden", { status: 403 });

  // Resolve the month window (defaults to the current month).
  const url = new URL(request.url);
  const { month, start, end } = resolveMonthWindow(url.searchParams.get("month") || "");

  const [rows, { data: assignments }, { data: rates }] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("timesheets")
        .select("work_date, hours, user_id, project_id, profiles(full_name, email), projects(name)")
        .gte("work_date", start)
        .lte("work_date", end)
        .order("work_date", { ascending: false })
        .range(from, to)
    ),
    supabase.from("assignments").select("id, user_id, project_id"),
    supabase.from("assignment_rates").select("assignment_id, bill_rate, pay_rate"),
  ]);

  const rateByPair = buildRateByPair(assignments, rates);

  const money = (cents: number) => (cents / 100).toFixed(2);
  const header = [
    "Date",
    "Employee",
    "Email",
    "Project",
    "Hours",
    "Bill Rate",
    "Pay Rate",
    "Revenue",
    "Cost",
    "Margin",
  ];
  const lines = [header.join(",")];

  for (const t of rows as any[]) {
    const hrs = Number(t.hours) || 0;
    const { bill, pay, revCents, costCents } = lineMoneyCents(hrs, rateByPair.get(`${t.user_id}:${t.project_id}`));
    const marginCents = revCents != null && costCents != null ? revCents - costCents : null;

    lines.push(
      [
        t.work_date,
        t.profiles?.full_name || "",
        t.profiles?.email || "",
        t.projects?.name || "",
        t.hours,
        bill != null ? Number(bill).toFixed(2) : "",
        pay != null ? Number(pay).toFixed(2) : "",
        revCents != null ? money(revCents) : "",
        costCents != null ? money(costCents) : "",
        marginCents != null ? money(marginCents) : "",
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sur-books-${month}.csv"`,
    },
  });
}
