// Shared money-layer helpers for the admin Books page and its CSV export.
// Keeping the month window, rate lookup and cents math in one place guarantees
// the on-screen books and the exported CSV can never silently diverge.
//
// Money is admin-only and computed/aggregated in integer cents.

type Rate = { bill_rate: number | null; pay_rate: number | null };

// Resolve the month window (defaults to the current month). The regex rejects
// impossible months (00, 13-99) so a malformed/tampered ?month= falls back to
// the default instead of building an out-of-range date query.
export function resolveMonthWindow(monthParam: string | null | undefined): {
  month: string;
  start: string;
  end: string;
  y: number;
  m: number;
} {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const month =
    typeof monthParam === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(monthParam)
      ? monthParam
      : defaultMonth;
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const start = `${month}-01`;
  const end = `${month}-${String(lastDay).padStart(2, "0")}`;
  return { month, start, end, y, m };
}

// Build the rate lookup keyed by "user_id:project_id" (an assignment is unique
// per that pair, and its rates cascade with it).
export function buildRateByPair(
  assignments: any[] | null | undefined,
  rates: any[] | null | undefined
): Map<string, Rate> {
  const rateByAssignment = new Map((rates ?? []).map((r: any) => [r.assignment_id, r]));
  const rateByPair = new Map<string, Rate>();
  for (const a of (assignments ?? []) as any[]) {
    const r = rateByAssignment.get(a.id);
    if (r) rateByPair.set(`${a.user_id}:${a.project_id}`, r);
  }
  return rateByPair;
}

// Turn one timesheet line into money. Revenue and cost are only counted when
// BOTH rates are present, so a half-configured pair (bill set, pay missing, or
// vice versa) contributes no money and is surfaced by the missing-rate guard —
// this keeps the totals honest and consistent between the page and the CSV.
export function lineMoneyCents(
  hours: number,
  rate: Rate | undefined
): { bill: number | null; pay: number | null; revCents: number | null; costCents: number | null } {
  const bill = rate?.bill_rate ?? null;
  const pay = rate?.pay_rate ?? null;
  const rated = bill != null && pay != null;
  const revCents = rated ? Math.round(hours * Number(bill) * 100) : null;
  const costCents = rated ? Math.round(hours * Number(pay) * 100) : null;
  return { bill, pay, revCents, costCents };
}

// Fetch every row of a query, paging in chunks so a busy month is never
// silently truncated by a configured PostgREST row cap (db.max_rows).
export async function fetchAllRows(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: any[] | null }>
): Promise<any[]> {
  const pageSize = 1000;
  const all: any[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data } = await makeQuery(from, from + pageSize - 1);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
