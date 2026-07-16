import Link from "next/link";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { generateInvoice } from "@/app/invoice-actions";
import {
  resolveMonthWindow,
  buildRateHistoryByPair,
  rateAsOf,
  lineMoneyCents,
  fetchAllRows,
  sumExpenseCents,
  usdCents,
} from "@/lib/books";

// Hours are numeric(5,2) summed as floats; round to 2dp before formatting.
const fmtHours = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

type Agg = { id: string; name: string; hours: number; revenue: number; billableCost: number; overhead: number };

export default async function Books({ searchParams }: { searchParams: Promise<{ month?: string; from?: string; to?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();

  const { month, start: mStart, end: mEnd, y, m } = resolveMonthWindow(sp.month);
  // Optional custom date range: ?from=YYYY-MM-DD&to=YYYY-MM-DD overrides the month
  // window for the on-screen figures. Invoicing stays monthly (see below).
  const isDate = (s?: string) => {
    if (typeof s !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`); // reject unreal dates (e.g. Feb 31) via round-trip
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  };
  const custom = isDate(sp.from) && isDate(sp.to) && (sp.from as string) <= (sp.to as string);
  const start = custom ? (sp.from as string) : mStart;
  const end = custom ? (sp.to as string) : mEnd;
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prevMonth = fmt(new Date(y, m - 2, 1));
  const nextMonth = fmt(new Date(y, m, 1));

  const [timesheets, { data: assignments }, { data: rates }, expenses] = await Promise.all([
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
    // Expenses spent in this month (admin-only via RLS). Paged like timesheets so
    // a high-volume month can't be silently truncated by the PostgREST row cap.
    fetchAllRows((from, to) =>
      supabase
        .from("expenses")
        .select("project_id, amount_cents")
        .gte("spent_on", start)
        .lte("spent_on", end)
        .order("id")
        .range(from, to)
    ),
  ]);

  const rateHistory = buildRateHistoryByPair(assignments, rates);

  // ── Aggregate. Billable = both rates; overhead = pay only; missing = no pay ──
  let totalHours = 0;
  let revenue = 0;
  let billableCost = 0;
  let overhead = 0;
  const byProject = new Map<string, Agg>();
  const byConsultant = new Map<string, Agg>();
  const missing = new Map<string, { person: string; project: string }>();

  for (const t of timesheets as any[]) {
    const hrs = Number(t.hours) || 0;
    const pairKey = `${t.user_id}:${t.project_id}`;
    const { missingPay, revCents, billableCostCents, overheadCents } = lineMoneyCents(hrs, rateAsOf(rateHistory.get(pairKey), String(t.work_date)));
    const rev = revCents ?? 0;
    const bc = billableCostCents ?? 0;
    const oh = overheadCents ?? 0;

    totalHours += hrs;
    revenue += rev;
    billableCost += bc;
    overhead += oh;

    const pName = t.projects?.name ?? "—";
    const cName = t.profiles?.full_name || t.profiles?.email || "—";

    const pa = byProject.get(t.project_id) ?? { id: t.project_id, name: pName, hours: 0, revenue: 0, billableCost: 0, overhead: 0 };
    pa.hours += hrs; pa.revenue += rev; pa.billableCost += bc; pa.overhead += oh;
    byProject.set(t.project_id, pa);

    const ca = byConsultant.get(t.user_id) ?? { id: t.user_id, name: cName, hours: 0, revenue: 0, billableCost: 0, overhead: 0 };
    ca.hours += hrs; ca.revenue += rev; ca.billableCost += bc; ca.overhead += oh;
    byConsultant.set(t.user_id, ca);

    if (missingPay) missing.set(pairKey, { person: cName, project: pName });
  }

  const margin = revenue - billableCost;
  const totalCost = billableCost + overhead;
  // Project expenses for the month reduce Net (labor cost + overhead + expenses).
  const expensesTotal = sumExpenseCents(expenses);
  const net = revenue - totalCost - expensesTotal;
  const marginPct = revenue > 0 ? (margin / revenue) * 100 : 0;
  const projects = [...byProject.values()].sort((a, b) => b.revenue - a.revenue);
  const consultants = [...byConsultant.values()].sort((a, b) => b.hours - a.hours);
  const missingList = [...missing.values()];

  const tile: React.CSSProperties = { border: "1px solid #e3e7ec", borderRadius: 12, padding: 16, background: "#fff" };
  const tileLabel: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6470", fontWeight: 600 };
  const tileValue: React.CSSProperties = { fontSize: 24, fontWeight: 700, marginTop: 6 };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">{BRAND.name.charAt(0)}</div>
          <div className="wordmark">{BRAND.name}<small>Books</small></div>
          <nav className="topnav">
            <Link className="navlink" href="/admin">Admin</Link>
            <Link className="navlink" href="/admin/payroll">Payroll</Link>
            <Link className="navlink" href="/admin/invoices">Invoices</Link>
            <a className="navlink" href={custom ? `/admin/books/export?from=${start}&to=${end}` : `/admin/books/export?month=${month}`}>Export CSV</a>
            <form action={signOut}><button type="submit" className="navlink navbtn">Log out</button></form>
          </nav>
        </div>
      </header>

      <main className="page admin">
        <section className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 className="card-title" style={{ margin: 0 }}>Books &mdash; {custom ? `${start} → ${end}` : monthLabel(month)}</h2>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
              <Link className="btn-sm" href={`/admin/books?month=${prevMonth}`}>← Prev</Link>
              <form method="get" style={{ display: "flex", gap: 6 }}>
                <input type="month" name="month" defaultValue={month} />
                <button type="submit" className="btn-sm">View</button>
              </form>
              <Link className="btn-sm" href={`/admin/books?month=${nextMonth}`}>Next →</Link>
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <span className="muted-cell" style={{ fontSize: 13 }}>Custom range</span>
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="hidden" name="month" value={month} />
              <input type="date" name="from" defaultValue={custom ? start : ""} required />
              <span className="muted-cell">→</span>
              <input type="date" name="to" defaultValue={custom ? end : ""} required />
              <button type="submit" className="btn-sm">Apply</button>
            </form>
            {custom && <Link className="btn-sm secondary" href={`/admin/books?month=${month}`}>Clear</Link>}
          </div>
          <p className="intro" style={{ marginTop: 8 }}>
            Revenue and cost from logged hours × rates. Billable = both rates set; overhead = pay-only
            (staff / internal time). Project expenses spent this month are subtracted from Net. Admin-only.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginTop: 8 }}>
            <div style={tile}><div style={tileLabel}>Revenue</div><div style={tileValue}>{usdCents(revenue)}</div></div>
            <div style={tile}><div style={tileLabel}>Billable cost</div><div style={tileValue}>{usdCents(billableCost)}</div></div>
            <div style={tile}><div style={tileLabel}>Margin</div><div style={{ ...tileValue, color: margin >= 0 ? "var(--green)" : "var(--red)" }}>{usdCents(margin)}</div></div>
            <div style={tile}><div style={tileLabel}>Margin %</div><div style={tileValue}>{revenue > 0 ? marginPct.toFixed(1) + "%" : "—"}</div></div>
            <div style={tile}><div style={tileLabel}>Overhead</div><div style={tileValue}>{usdCents(overhead)}</div></div>
            <div style={tile}><div style={tileLabel}>Expenses</div><div style={{ ...tileValue, color: expensesTotal > 0 ? "var(--red)" : undefined }}>{usdCents(expensesTotal)}</div></div>
            <div style={tile}><div style={tileLabel}>Net (after all costs)</div><div style={{ ...tileValue, color: net >= 0 ? "var(--green)" : "var(--red)" }}>{usdCents(net)}</div></div>
            <div style={tile}><div style={tileLabel}>Hours</div><div style={tileValue}>{fmtHours(totalHours)}</div></div>
          </div>
        </section>

        {missingList.length > 0 && (
          <section className="card" style={{ borderLeft: "4px solid #f79009" }}>
            <h2 className="card-title">
              ⚠️ {missingList.length} person/project pair{missingList.length === 1 ? "" : "s"} logged hours without a pay rate
            </h2>
            <p className="intro">
              Their hours count in the Hours total but not in cost/margin, since there&apos;s no pay rate to price them.
              Set a pay rate on the <Link href="/admin">Admin page</Link> (bill rate is optional — leave it blank for
              overhead / staff time). If the person was unassigned after logging, re-assign them first.
            </p>
            <table className="tbl">
              <thead><tr><th>Person</th><th>Project</th></tr></thead>
              <tbody>
                {missingList.map((r, i) => (<tr key={i}><td>{r.person}</td><td>{r.project}</td></tr>))}
              </tbody>
            </table>
          </section>
        )}

        <section className="card">
          <h2 className="card-title">By project</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Project</th>
                <th className="right">Hours</th>
                <th className="right">Revenue</th>
                <th className="right">Cost</th>
                <th className="right">Overhead</th>
                <th className="right">Margin</th>
                <th className="right">Margin %</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const pMargin = p.revenue - p.billableCost;
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="right">{fmtHours(p.hours)}</td>
                    <td className="right">{usdCents(p.revenue)}</td>
                    <td className="right">{usdCents(p.billableCost)}</td>
                    <td className="right muted-cell">{p.overhead ? usdCents(p.overhead) : "—"}</td>
                    <td className="right" style={{ color: pMargin >= 0 ? "var(--green)" : "var(--red)" }}>{usdCents(pMargin)}</td>
                    <td className="right muted-cell">{p.revenue > 0 ? ((pMargin / p.revenue) * 100).toFixed(1) + "%" : "—"}</td>
                    <td className="right">
                      {custom ? (
                        <span className="muted-cell" title="Switch to a month view to generate invoices">—</span>
                      ) : (
                        <form action={generateInvoice}>
                          <input type="hidden" name="project_id" value={p.id} />
                          <input type="hidden" name="month" value={month} />
                          <button type="submit" className="btn-sm" title="Generate a draft invoice for this project & month">Invoice</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
              {projects.length === 0 && (<tr><td colSpan={8} className="muted-cell">No hours logged for this period.</td></tr>)}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2 className="card-title">By consultant</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Consultant</th>
                <th className="right">Hours</th>
                <th className="right">Pay (cost)</th>
                <th className="right">Revenue generated</th>
              </tr>
            </thead>
            <tbody>
              {consultants.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="right">{fmtHours(c.hours)}</td>
                  <td className="right">{usdCents(c.billableCost + c.overhead)}</td>
                  <td className="right muted-cell">{usdCents(c.revenue)}</td>
                </tr>
              ))}
              {consultants.length === 0 && (<tr><td colSpan={4} className="muted-cell">No hours logged for this period.</td></tr>)}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
