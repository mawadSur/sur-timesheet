import { createClient } from "@/lib/supabase/server";
import { csvCell } from "@/lib/csv";
import { resolveMonthWindow, buildRateHistoryByPair, rateAsOf, lineMoneyCents, fetchAllRows } from "@/lib/books";

// Money-aware timesheet export: hours × per-assignment rates → revenue/cost/margin,
// with overhead (pay-only) broken out. Admin-only (middleware gates /admin, and
// we re-check here as defence in depth).
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

  const url = new URL(request.url);
  // Optional custom date range mirrors the Books page; falls back to a month.
  const isDate = (s: string | null) => {
    if (!s || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`); // reject unreal dates (e.g. Feb 31) via round-trip
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const customRange = isDate(fromParam) && isDate(toParam) && (fromParam as string) <= (toParam as string);
  const mw = resolveMonthWindow(url.searchParams.get("month") || "");
  const start = customRange ? (fromParam as string) : mw.start;
  const end = customRange ? (toParam as string) : mw.end;
  const label = customRange ? `${start}_to_${end}` : mw.month;

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
    supabase.from("assignment_rates").select("assignment_id, bill_rate, pay_rate, effective_from"),
  ]);

  const rateHistory = buildRateHistoryByPair(assignments, rates);
  const money = (cents: number) => (cents / 100).toFixed(2);
  const header = ["Date", "Employee", "Email", "Project", "Hours", "Bill Rate", "Pay Rate", "Revenue", "Billable Cost", "Overhead", "Margin"];
  const lines = [header.join(",")];

  for (const t of rows as any[]) {
    const hrs = Number(t.hours) || 0;
    const { bill, pay, revCents, billableCostCents, overheadCents } = lineMoneyCents(
      hrs,
      rateAsOf(rateHistory.get(`${t.user_id}:${t.project_id}`), String(t.work_date))
    );
    const marginCents = revCents != null && billableCostCents != null ? revCents - billableCostCents : null;

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
        billableCostCents != null ? money(billableCostCents) : "",
        overheadCents != null ? money(overheadCents) : "",
        marginCents != null ? money(marginCents) : "",
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="sur-books-${label}.csv"`,
    },
  });
}
