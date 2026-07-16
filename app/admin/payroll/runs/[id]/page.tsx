import Link from "next/link";
import { notFound } from "next/navigation";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import {
  markPayrollRunPaid,
  regeneratePayrollRun,
  voidPayrollRun,
  deletePayrollRun,
} from "@/app/payroll-actions";
import { usdCents } from "@/lib/books";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function periodLabel(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sd}–${ed}, ${sy}`;
  return `${MONTHS[sm - 1]} ${sd}, ${sy} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
}

const fmtHours = (n: number) => (Math.round(Number(n) * 100) / 100).toLocaleString("en-US");

const badgeBase: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
};
function statusStyle(status: string): React.CSSProperties {
  switch (status) {
    case "paid":
      return { background: "#e6f6ec", color: "#1a7f37", border: "1px solid #b7e3c4" };
    case "void":
      return { background: "#eef0f2", color: "#5b6470", border: "1px solid #d6dade" };
    default:
      return { background: "#fff5e0", color: "#a15c00", border: "1px solid #f3d8a0" };
  }
}

export default async function PayrollRunDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("payroll_runs")
    .select("*")
    .eq("id", id)
    .single();
  if (!run) notFound();

  const { data: lineRows } = await supabase
    .from("payroll_run_lines")
    .select("user_id, user_name, project_id, project_name, hours, pay_rate, amount_cents")
    .eq("run_id", id)
    .order("amount_cents", { ascending: false });

  const lines = (lineRows ?? []) as any[];

  // Group lines by contractor into pay stubs.
  type Stub = { user_id: string; name: string; subtotal_cents: number; lines: any[] };
  const byUser = new Map<string, Stub>();
  for (const l of lines) {
    let s = byUser.get(l.user_id);
    if (!s) {
      s = { user_id: l.user_id, name: l.user_name || "—", subtotal_cents: 0, lines: [] };
      byUser.set(l.user_id, s);
    }
    s.lines.push(l);
    s.subtotal_cents += Number(l.amount_cents || 0);
  }
  const stubs = [...byUser.values()].sort((a, b) => b.subtotal_cents - a.subtotal_cents);

  const isDraft = run.status === "draft";
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">{BRAND.name.charAt(0)}</div>
          <div className="wordmark">{BRAND.name}<small>Payroll run</small></div>
          <nav className="topnav">
            <Link className="navlink" href="/admin/payroll/runs">Runs</Link>
            <Link className="navlink" href="/admin/payroll">Payroll</Link>
            <Link className="navlink" href="/admin/books">Books</Link>
            <a className="navlink" href={`/admin/payroll/runs/${run.id}/export`}>Download CSV</a>
            <form action={signOut}><button type="submit" className="navlink navbtn">Log out</button></form>
          </nav>
        </div>
      </header>

      <main className="page admin">
        {/* ── Run header ───────────────────────────────────────────── */}
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 className="card-title" style={{ marginBottom: 4 }}>
                Payroll — {periodLabel(run.period_start, run.period_end)}
              </h2>
              <div style={{ color: "#5b6470", fontSize: 14 }}>
                {run.period_start} → {run.period_end}
              </div>
            </div>
            <span style={{ ...badgeBase, ...statusStyle(run.status) }}>{run.status}</span>
          </div>

          <div style={{ display: "flex", gap: 40, flexWrap: "wrap", marginTop: 14, fontSize: 14 }}>
            <div>
              <div style={{ color: "#5b6470", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>Total payout</div>
              <div style={{ marginTop: 4, fontSize: 22, fontWeight: 700 }}>{usdCents(Number(run.total_cents || 0))}</div>
            </div>
            <div>
              <div style={{ color: "#5b6470", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>Dates</div>
              <div style={{ marginTop: 4 }}>
                Created: {run.created_at ? String(run.created_at).slice(0, 10) : "—"}<br />
                Paid: {run.paid_on || "—"}
              </div>
            </div>
          </div>

          {/* ── Status actions ─────────────────────────────────────── */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>
            {isDraft && (
              <>
                <form action={markPayrollRunPaid} className="row-form">
                  <input type="hidden" name="id" value={run.id} />
                  <input name="paid_on" type="date" defaultValue={today} title="Date paid (defaults to today)" />
                  <button type="submit" className="btn">Mark paid</button>
                </form>
                <form action={regeneratePayrollRun}>
                  <input type="hidden" name="id" value={run.id} />
                  <button type="submit" className="btn-sm">Refresh from timesheets</button>
                </form>
                <form action={deletePayrollRun}>
                  <input type="hidden" name="id" value={run.id} />
                  <button type="submit" className="link-btn">Delete draft</button>
                </form>
              </>
            )}
            {run.status === "paid" && (
              <>
                <span className="badge badge-ok">Paid {run.paid_on || ""}</span>
                <form action={voidPayrollRun}>
                  <input type="hidden" name="id" value={run.id} />
                  <button type="submit" className="link-btn">Void</button>
                </form>
              </>
            )}
            {run.status === "void" && (
              <>
                <span className="badge">Voided</span>
                <form action={deletePayrollRun}>
                  <input type="hidden" name="id" value={run.id} />
                  <button type="submit" className="link-btn">Delete voided run</button>
                </form>
                <span className="muted-cell" style={{ fontSize: 13 }}>
                  Deleting frees this pay period so it can be finalized again.
                </span>
              </>
            )}
          </div>
        </section>

        {/* ── Pay stubs ────────────────────────────────────────────── */}
        {stubs.length === 0 && (
          <section className="card">
            <p className="intro" style={{ margin: 0 }}>No contractor lines in this run.</p>
          </section>
        )}
        {stubs.map((s) => (
          <section className="card" key={s.user_id}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <h2 className="card-title" style={{ margin: 0 }}>{s.name}</h2>
              <strong style={{ marginLeft: "auto" }}>{usdCents(s.subtotal_cents)}</strong>
            </div>
            <table className="tbl" style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Project</th>
                  <th className="right">Hours</th>
                  <th className="right">Pay rate</th>
                  <th className="right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {s.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.project_name || "—"}</td>
                    <td className="right">{fmtHours(l.hours)}</td>
                    <td className="right">
                      {l.pay_rate != null
                        ? `$${Number(l.pay_rate).toFixed(2)}/h`
                        : <span className="muted-cell">{Number(l.amount_cents || 0) > 0 ? "mixed" : "—"}</span>}
                    </td>
                    <td className="right">{usdCents(Number(l.amount_cents || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </main>
    </>
  );
}
