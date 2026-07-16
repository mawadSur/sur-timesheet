// Payroll: semi-monthly contractor payouts. Two pay periods per month — the
// 1st–15th (paid on the 15th) and the 16th–month-end (paid at month-end). A
// contractor's payout for a period is Σ(hours logged × their per-project
// pay_rate) across every project they logged to in that window.
//
// pay_rate is the per-assignment cost of an hour (see lib/books.ts). Hours with
// no pay_rate set can't be priced, so they're FLAGGED (hasMissingRate) and
// counted in the hours total but not the dollar total — never silently dropped.
//
// Rounding: hours are summed per (contractor, project) first, then priced once
// (round half-up on the line), and the contractor total is the sum of the line
// cents. This keeps a single rounding step per line instead of per timesheet row.

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const pad2 = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m: number, half: 1 | 2) => `${y}-${pad2(m)}-${half}`;

export type PayPeriod = {
  key: string; // "YYYY-MM-H" where H is 1 (1st–15th) or 2 (16th–EOM)
  half: 1 | 2;
  start: string; // YYYY-MM-DD, inclusive
  end: string; // YYYY-MM-DD, inclusive
  payDate: string; // YYYY-MM-DD — the 15th or the last day of the month
  label: string; // e.g. "Jul 1–15, 2026"
  payLabel: string; // e.g. "paid Jul 15"
  prevKey: string;
  nextKey: string;
};

function buildPeriod(y: number, m: number, half: 1 | 2): PayPeriod {
  const lastDay = new Date(y, m, 0).getDate(); // day 0 of next month = last of this
  const startDay = half === 1 ? 1 : 16;
  const endDay = half === 1 ? 15 : lastDay;
  const start = `${y}-${pad2(m)}-${pad2(startDay)}`;
  const end = `${y}-${pad2(m)}-${pad2(endDay)}`;
  const mon = MONTHS[m - 1];

  // Previous period: half 1 → prior month's half 2; half 2 → this month's half 1.
  let pY = y, pM = m;
  const pH: 1 | 2 = half === 1 ? 2 : 1;
  if (half === 1) {
    pM = m - 1;
    if (pM < 1) { pM = 12; pY = y - 1; }
  }
  // Next period: half 1 → this month's half 2; half 2 → next month's half 1.
  let nY = y, nM = m;
  const nH: 1 | 2 = half === 1 ? 2 : 1;
  if (half === 2) {
    nM = m + 1;
    if (nM > 12) { nM = 1; nY = y + 1; }
  }

  return {
    key: keyOf(y, m, half),
    half,
    start,
    end,
    payDate: end, // paid on the closing day of the window (15th / month-end)
    label: `${mon} ${startDay}–${endDay}, ${y}`,
    payLabel: `paid ${mon} ${endDay}`,
    prevKey: keyOf(pY, pM, pH),
    nextKey: keyOf(nY, nM, nH),
  };
}

// Resolve a pay period from a "YYYY-MM-H" param, defaulting to the period that
// contains `now` (day ≤ 15 → half 1, else half 2). A malformed/tampered param
// falls back to the default rather than building an out-of-range window.
export function resolvePayPeriod(
  param?: string | null,
  now: Date = new Date()
): PayPeriod {
  if (typeof param === "string" && /^\d{4}-(0[1-9]|1[0-2])-[12]$/.test(param)) {
    const [yy, mm, hh] = param.split("-");
    return buildPeriod(Number(yy), Number(mm), Number(hh) as 1 | 2);
  }
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const half: 1 | 2 = now.getDate() <= 15 ? 1 : 2;
  return buildPeriod(y, m, half);
}

export type PayrollLine = {
  project_id: string;
  project_name: string;
  hours: number;
  pay_rate: number | null;
  amount_cents: number;
  missingRate: boolean;
};

export type PayrollRow = {
  user_id: string;
  name: string;
  email: string | null;
  hours: number;
  amount_cents: number;
  hasMissingRate: boolean;
  projects: PayrollLine[];
};

type PayRate = { pay_rate: number | null; bill_rate?: number | null };

// Aggregate timesheet rows for a period into one payout row per contractor, each
// with a per-project breakdown. `rateByPair` is keyed "user_id:project_id" (see
// buildRateByPair in lib/books.ts). Rows are expected to carry the joined
// profiles(full_name, email) and projects(name).
export function payrollByContractor(
  rows: any[],
  rateByPair: Map<string, PayRate>
): PayrollRow[] {
  type Acc = {
    user_id: string;
    name: string;
    email: string | null;
    hours: number;
    projects: Map<string, PayrollLine>;
  };
  const byUser = new Map<string, Acc>();

  for (const t of rows ?? []) {
    const hrs = Number(t.hours) || 0;
    if (hrs <= 0) continue; // ignore zero/negative rows
    const rate = rateByPair.get(`${t.user_id}:${t.project_id}`);
    const pay = rate?.pay_rate ?? null;
    const name = t.profiles?.full_name || t.profiles?.email || "—";
    const email = t.profiles?.email ?? null;
    const projectName = t.projects?.name || "—";

    let u = byUser.get(t.user_id);
    if (!u) {
      u = { user_id: t.user_id, name, email, hours: 0, projects: new Map() };
      byUser.set(t.user_id, u);
    }
    u.hours += hrs;

    let line = u.projects.get(t.project_id);
    if (!line) {
      line = {
        project_id: t.project_id,
        project_name: projectName,
        hours: 0,
        pay_rate: pay,
        amount_cents: 0,
        missingRate: pay == null,
      };
      u.projects.set(t.project_id, line);
    }
    line.hours += hrs;
  }

  const out: PayrollRow[] = [];
  for (const u of byUser.values()) {
    const projects = [...u.projects.values()]
      .map((l) => ({
        ...l,
        // Price the summed hours once (half-up), so per-row rounding can't drift.
        amount_cents: l.pay_rate != null ? Math.round(l.hours * Number(l.pay_rate) * 100) : 0,
      }))
      .sort((a, b) => b.amount_cents - a.amount_cents || b.hours - a.hours);
    const amount_cents = projects.reduce((s, l) => s + l.amount_cents, 0);
    const hasMissingRate = projects.some((l) => l.missingRate);
    out.push({
      user_id: u.user_id,
      name: u.name,
      email: u.email,
      hours: u.hours,
      amount_cents,
      hasMissingRate,
      projects,
    });
  }
  // Highest payout first; ties broken by hours so unpriced-but-active people surface.
  return out.sort((a, b) => b.amount_cents - a.amount_cents || b.hours - a.hours);
}
