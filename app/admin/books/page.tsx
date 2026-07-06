import Link from "next/link";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import {
  resolveMonthWindow,
  buildRateByPair,
  lineMoneyCents,
  fetchAllRows,
} from "@/lib/books";

// Money is stored/aggregated in integer cents to avoid floating-point drift,
// then formatted once at the edge. The sign sits outside the currency symbol
// so a loss reads as "-$1,234.00", not "$-1,234.00".
const usd = (cents: number) =>
  (cents < 0 ? "-$" : "$") +
  Math.abs(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

// Hours are numeric(5,2) summed as floats; round to 2dp before formatting so
// no floating-point tail leaks into the tables or tile.
const fmtHours = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

type Agg = { name: string; hours: number; revenue: number; cost: number };

export default async function Books({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  // ── Resolve the month window (defaults to the current month) ──────────────
  const { month, start, end, y, m } = resolveMonthWindow(sp.month);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prevMonth = fmt(new Date(y, m - 2, 1));
  const nextMonth = fmt(new Date(y, m, 1));

  // ── Pull the ledger + rates (admin RLS returns everything) ────────────────
  const [timesheets, { data: assignments }, { data: rates }] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("timesheets")
        .select("user_id, project_id, hours, profiles(full_name, email), projects(name)")
        .gte("work_date", start)
        .lte("work_date", end)
        .range(from, to)
    ),
    supabase.from("assignments").select("id, user_id, project_id"),
    supabase.from("assignment_rates").select("assignment_id, bill_rate, pay_rate"),
  ]);

  // rate keyed by "user_id:project_id" (assignments are unique per that pair)
  const rateByPair = buildRateByPair(assignments, rates);

  // ── Aggregate ─────────────────────────────────────────────────────────────
  let totalHours = 0;
  let revenue = 0; // cents
  let cost = 0; // cents
  const byProject = new Map<string, Agg>();
  const byConsultant = new Map<string, Agg>();
  const missing = new Map<string, { person: string; project: string; noBill: boolean; noPay: boolean }>();

  for (const t of timesheets as any[]) {
    const hrs = Number(t.hours) || 0;
    const pairKey = `${t.user_id}:${t.project_id}`;
    const { bill, pay, revCents, costCents } = lineMoneyCents(hrs, rateByPair.get(pairKey));
    const rev = revCents ?? 0;
    const cst = costCents ?? 0;

    totalHours += hrs;
    revenue += rev;
    cost += cst;

    const pName = t.projects?.name ?? "—";
    const cName = t.profiles?.full_name || t.profiles?.email || "—";

    const pa = byProject.get(t.project_id) ?? { name: pName, hours: 0, revenue: 0, cost: 0 };
    pa.hours += hrs;
    pa.revenue += rev;
    pa.cost += cst;
    byProject.set(t.project_id, pa);

    const ca = byConsultant.get(t.user_id) ?? { name: cName, hours: 0, revenue: 0, cost: 0 };
    ca.hours += hrs;
    ca.revenue += rev;
    ca.cost += cst;
    byConsultant.set(t.user_id, ca);

    if (bill == null || pay == null) {
      missing.set(pairKey, { person: cName, project: pName, noBill: bill == null, noPay: pay == null });
    }
  }

  const margin = revenue - cost;
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
  const projects = [...byProject.values()].sort((a, b) => b.revenue - a.revenue);
  const consultants = [...byConsultant.values()].sort((a, b) => b.hours - a.hours);
  const missingList = [...missing.values()];

  const tile: React.CSSProperties = {
    border: "1px solid #e3e7ec",
    borderRadius: 12,
    padding: 16,
    background: "#fff",
  };
  const tileLabel: React.CSSProperties = {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "#5b6470",
    fontWeight: 600,
  };
  const tileValue: React.CSSProperties = { fontSize: 24, fontWeight: 700, marginTop: 6 };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">{BRAND.name.charAt(0)}</div>
          <div className="wordmark">
            {BRAND.name}
            <small>Books</small>
          </div>
          <nav className="topnav">
            <Link className="navlink" href="/admin">
              Admin
            </Link>
            <Link className="navlink" href="/admin/dashboard">
              Dashboard
            </Link>
            <a className="navlink" href={`/admin/books/export?month=${month}`}>
              Export CSV
            </a>
            <form action={signOut}>
              <button type="submit" className="navlink navbtn">
                Log out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="page admin">
        {/* ── Month picker ────────────────────────────────────────────── */}
        <section className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 className="card-title" style={{ margin: 0 }}>
              Books &mdash; {monthLabel(month)}
            </h2>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
              <Link className="btn-sm" href={`/admin/books?month=${prevMonth}`}>
                ← Prev
              </Link>
              <form method="get" style={{ display: "flex", gap: 6 }}>
                <input type="month" name="month" defaultValue={month} />
                <button type="submit" className="btn-sm">
                  View
                </button>
              </form>
              <Link className="btn-sm" href={`/admin/books?month=${nextMonth}`}>
                Next →
              </Link>
            </div>
          </div>
          <p className="intro" style={{ marginTop: 8 }}>
            Revenue, cost and margin computed from logged hours × per-assignment rates.
            Admin-only.
          </p>

          {/* ── Summary tiles ─────────────────────────────────────────── */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
              gap: 12,
              marginTop: 8,
            }}
          >
            <div style={tile}>
              <div style={tileLabel}>Revenue</div>
              <div style={tileValue}>{usd(revenue)}</div>
            </div>
            <div style={tile}>
              <div style={tileLabel}>Cost</div>
              <div style={tileValue}>{usd(cost)}</div>
            </div>
            <div style={tile}>
              <div style={tileLabel}>Margin</div>
              <div style={{ ...tileValue, color: margin >= 0 ? "var(--green)" : "var(--red)" }}>
                {usd(margin)}
              </div>
            </div>
            <div style={tile}>
              <div style={tileLabel}>Margin %</div>
              <div style={tileValue}>{revenue > 0 ? marginPct.toFixed(1) + "%" : "—"}</div>
            </div>
            <div style={tile}>
              <div style={tileLabel}>Hours</div>
              <div style={tileValue}>{fmtHours(totalHours)}</div>
            </div>
          </div>
        </section>

        {/* ── Missing-rate guard: never let money be silently undercounted ── */}
        {missingList.length > 0 && (
          <section className="card" style={{ borderLeft: "4px solid #f79009" }}>
            <h2 className="card-title">
              ⚠️ {missingList.length} person/project pair{missingList.length === 1 ? "" : "s"} logged
              hours this month without a complete rate
            </h2>
            <p className="intro">
              The hours still count in the Hours totals, but the revenue and cost for these are
              excluded from the totals above. For a pair that still has a live assignment, set its
              rate on the <Link href="/admin">Admin page</Link>. If the person was unassigned from
              the project after logging these hours, re-assign them there first (that recreates the
              assignment and its rate input); once the rate is set it retroactively fills this month,
              since rates are matched by person and project.
            </p>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Project</th>
                  <th>Missing</th>
                </tr>
              </thead>
              <tbody>
                {missingList.map((r, i) => (
                  <tr key={i}>
                    <td>{r.person}</td>
                    <td>{r.project}</td>
                    <td className="muted-cell">
                      {[r.noBill ? "bill rate" : null, r.noPay ? "pay rate" : null]
                        .filter(Boolean)
                        .join(" + ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* ── By project ────────────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">By project</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Project</th>
                <th className="right">Hours</th>
                <th className="right">Revenue</th>
                <th className="right">Cost</th>
                <th className="right">Margin</th>
                <th className="right">Margin %</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p, i) => (
                <tr key={i}>
                  <td>{p.name}</td>
                  <td className="right">{fmtHours(p.hours)}</td>
                  <td className="right">{usd(p.revenue)}</td>
                  <td className="right">{usd(p.cost)}</td>
                  <td className="right" style={{ color: p.revenue - p.cost >= 0 ? "var(--green)" : "var(--red)" }}>
                    {usd(p.revenue - p.cost)}
                  </td>
                  <td className="muted-cell right">
                    {p.revenue > 0 ? (((p.revenue - p.cost) / p.revenue) * 100).toFixed(1) + "%" : "—"}
                  </td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted-cell">
                    No hours logged this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ── By consultant ─────────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">By consultant</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Consultant</th>
                <th className="right">Hours</th>
                <th className="right">Cost (payable)</th>
                <th className="right">Revenue generated</th>
              </tr>
            </thead>
            <tbody>
              {consultants.map((c, i) => (
                <tr key={i}>
                  <td>{c.name}</td>
                  <td className="right">{fmtHours(c.hours)}</td>
                  <td className="right">{usd(c.cost)}</td>
                  <td className="muted-cell right">{usd(c.revenue)}</td>
                </tr>
              ))}
              {consultants.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted-cell">
                    No hours logged this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
