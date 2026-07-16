import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createPayrollRun } from "@/app/payroll-actions";
import { buildRateHistoryByPair, fetchAllRows, usdCents } from "@/lib/books";
import { resolvePayPeriod, payrollByContractor } from "@/lib/payroll";

const fmtHours = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");

export default async function Payroll({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const sp = await searchParams;
  const supabase = await createClient();
  const period = resolvePayPeriod(sp.period);

  const [timesheets, { data: assignments }, { data: rates }] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase
        .from("timesheets")
        .select("work_date, user_id, project_id, hours, profiles(full_name, email), projects(name)")
        .gte("work_date", period.start)
        .lte("work_date", period.end)
        .order("id")
        .range(from, to)
    ),
    supabase.from("assignments").select("id, user_id, project_id"),
    supabase.from("assignment_rates").select("assignment_id, bill_rate, pay_rate, effective_from"),
  ]);

  const rateHistory = buildRateHistoryByPair(assignments, rates);
  const rows = payrollByContractor(timesheets, rateHistory);

  const totalCents = rows.reduce((s, r) => s + r.amount_cents, 0);
  const totalHours = rows.reduce((s, r) => s + r.hours, 0);
  const missing = rows.filter((r) => r.hasMissingRate);

  const tile: React.CSSProperties = { border: "1px solid #e3e7ec", borderRadius: 12, padding: 16, background: "#fff" };
  const tileLabel: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6470", fontWeight: 600 };
  const tileValue: React.CSSProperties = { fontSize: 24, fontWeight: 700, marginTop: 6 };

  return (
    <>
      <main className="page admin">
        <section className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 className="card-title" style={{ margin: 0 }}>Payroll &mdash; {period.label}</h2>
            <span className="badge badge-ok" style={{ textTransform: "none" }}>{period.payLabel}</span>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
              <Link className="btn-sm" href={`/admin/payroll?period=${period.prevKey}`}>← Prev</Link>
              <Link className="btn-sm" href={`/admin/payroll?period=${period.nextKey}`}>Next →</Link>
              <form action={createPayrollRun}>
                <input type="hidden" name="period_key" value={period.key} />
                <button type="submit" className="btn">Finalize as payroll run</button>
              </form>
            </div>
          </div>
          <p className="intro" style={{ marginTop: 8 }}>
            What to pay each contractor this pay period: their logged hours × the pay rate on each
            project they worked. Two periods a month — the 1st–15th (paid the 15th) and the
            16th–month-end (paid at month-end). Admin-only.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 8 }}>
            <div style={tile}><div style={tileLabel}>Total payout</div><div style={tileValue}>{usdCents(totalCents)}</div></div>
            <div style={tile}><div style={tileLabel}>Contractors</div><div style={tileValue}>{rows.length}</div></div>
            <div style={tile}><div style={tileLabel}>Hours</div><div style={tileValue}>{fmtHours(totalHours)}</div></div>
            <div style={tile}><div style={tileLabel}>Pay date</div><div style={tileValue}>{period.payDate}</div></div>
          </div>
        </section>

        {missing.length > 0 && (
          <section className="card" style={{ borderLeft: "4px solid #f79009" }}>
            <h2 className="card-title">
              ⚠️ {missing.length} contractor{missing.length === 1 ? "" : "s"} logged hours without a pay rate
            </h2>
            <p className="intro">
              Those hours show in the Hours total but can&apos;t be priced, so they&apos;re excluded from the payout.
              Set a pay rate on the <Link href="/admin">Admin page</Link> and they&apos;ll be included.
            </p>
          </section>
        )}

        <section className="card">
          <h2 className="card-title">By contractor</h2>
          {rows.length === 0 && <p className="intro">No hours logged in this pay period.</p>}
          {rows.map((r) => (
            <details key={r.user_id} style={{ borderTop: "1px solid #eef1f4", padding: "10px 0" }}>
              <summary style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer", listStyle: "revert" }}>
                <strong>{r.name}</strong>
                {r.hasMissingRate && <span className="badge" style={{ background: "#fff4e5", color: "#b54708" }}>⚠ missing rate</span>}
                <span className="muted-cell" style={{ marginLeft: "auto" }}>{fmtHours(r.hours)} h</span>
                <strong style={{ minWidth: 110, textAlign: "right" }}>{usdCents(r.amount_cents)}</strong>
              </summary>
              <table className="tbl" style={{ marginTop: 10 }}>
                <thead>
                  <tr><th>Project</th><th className="right">Hours</th><th className="right">Pay rate</th><th className="right">Amount</th></tr>
                </thead>
                <tbody>
                  {r.projects.map((l) => (
                    <tr key={l.project_id}>
                      <td>{l.project_name}</td>
                      <td className="right">{fmtHours(l.hours)}</td>
                      <td className="right">{l.pay_rate != null ? `$${Number(l.pay_rate).toFixed(2)}/h` : <span className="muted-cell">{l.mixedRate ? "mixed" : "— none —"}</span>}</td>
                      <td className="right">{l.missingRate ? <span className="muted-cell">—</span> : usdCents(l.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </section>
      </main>
    </>
  );
}
