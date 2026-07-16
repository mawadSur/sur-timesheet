// Shared money-layer helpers for the admin Books page, invoices, and CSV export.
// Keeping the month window, rate lookup and cents math in one place guarantees
// the on-screen books, the invoices and the exported CSV can never diverge.
//
// Money is admin-only and computed/aggregated in integer cents.
//
// Billing model (per assignment):
//   - pay_rate is REQUIRED for a line to be "complete" — you always have a cost
//     for hours worked. A missing pay_rate is the only thing the guard warns on.
//   - bill_rate is OPTIONAL. Present  => billable (client revenue + margin).
//                            Absent   => overhead (internal / staff time: cost
//                                        only, never invoiced to a client).

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

export type LineMoney = {
  bill: number | null;
  pay: number | null;
  missingPay: boolean; // pay rate absent — the only "incomplete" state we warn on
  billable: boolean; // both rates present — counts as client revenue + cost
  revCents: number | null; // client revenue (billable only)
  billableCostCents: number | null; // our cost of billable hours
  overheadCents: number | null; // our cost of non-billable (overhead) hours
};

// Turn one timesheet line into money under the per-assignment billing model.
export function lineMoneyCents(hours: number, rate: Rate | undefined): LineMoney {
  const bill = rate?.bill_rate ?? null;
  const pay = rate?.pay_rate ?? null;
  const missingPay = pay == null;
  const billable = pay != null && bill != null;
  const overhead = pay != null && bill == null;
  return {
    bill,
    pay,
    missingPay,
    billable,
    revCents: billable ? Math.round(hours * Number(bill) * 100) : null,
    billableCostCents: billable ? Math.round(hours * Number(pay) * 100) : null,
    overheadCents: overhead ? Math.round(hours * Number(pay) * 100) : null,
  };
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

// Aggregate a project's BILLABLE hours for a period into one invoice line per
// consultant (hours × bill_rate). Overhead (no bill rate) is never invoiced.
// Returns snapshot-ready lines; totals are summed in integer cents.
export function billableInvoiceLines(
  rows: any[],
  rateByPair: Map<string, Rate>
): { user_id: string; name: string; hours: number; bill_rate: number; amount_cents: number }[] {
  const byUser = new Map<
    string,
    { user_id: string; name: string; hours: number; bill_rate: number; amount_cents: number }
  >();
  for (const t of rows) {
    const hrs = Number(t.hours) || 0;
    const rate = rateByPair.get(`${t.user_id}:${t.project_id}`);
    const bill = rate?.bill_rate ?? null;
    const pay = rate?.pay_rate ?? null;
    if (bill == null || pay == null) continue; // billable only (both rates present)
    const name = t.profiles?.full_name || t.profiles?.email || "—";
    const line =
      byUser.get(t.user_id) ??
      { user_id: t.user_id, name, hours: 0, bill_rate: Number(bill), amount_cents: 0 };
    line.hours += hrs;
    line.amount_cents += Math.round(hrs * Number(bill) * 100);
    byUser.set(t.user_id, line);
  }
  return [...byUser.values()].sort((a, b) => b.amount_cents - a.amount_cents);
}

// Parse a user-entered dollar amount into non-negative integer cents (half-up).
// Blank / invalid / negative / absurd input returns null so callers can treat it
// as "leave unset" rather than silently writing a garbage value. Tolerates "$"
// and thousands separators ("$1,250.50" -> 125050).
export function dollarsToCents(input: FormDataEntryValue | string | null | undefined): number | null {
  const s = String(input ?? "").trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) return null;
  // Cancel binary-float error before the half-up round so a sub-cent input like
  // "1.005" (1.005*100 === 100.49999999999999) rounds up to 101, not down to 100.
  return Math.round(Number((n * 100).toFixed(4)));
}

// Sum an expense ledger's amount_cents (integer cents, no float drift).
export function sumExpenseCents(rows: { amount_cents?: number | string | null }[] | null | undefined): number {
  return (rows ?? []).reduce((s, r) => s + (Number(r.amount_cents) || 0), 0);
}

// Format integer cents as USD; sign sits outside the symbol ("-$1,234.00").
export function usdCents(cents: number): string {
  return (
    (cents < 0 ? "-$" : "$") +
    Math.abs(cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}
