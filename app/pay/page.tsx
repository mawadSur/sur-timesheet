import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { usdCents } from "@/lib/books";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function periodLabel(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sd}–${ed}, ${sy}`;
  return `${MONTHS[sm - 1]} ${sd}, ${sy} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
}

const fmtHours = (n: number) => (Math.round(Number(n) * 100) / 100).toLocaleString("en-US");

// Rows returned by the my_pay_stubs() RPC — the caller's OWN paid lines only,
// with safe run fields. Deliberately no total_cents.
type PayStubRow = {
  run_id: string;
  period_start: string;
  period_end: string;
  paid_on: string | null;
  project_name: string | null;
  hours: number | string | null;
  pay_rate: number | string | null;
  amount_cents: number | string | null;
};

export default async function PayStubs() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase.rpc("my_pay_stubs");
  const rows = (data ?? []) as PayStubRow[];

  // Group the caller's own paid lines into pay periods (one card per run).
  type Period = {
    run_id: string;
    period_start: string;
    period_end: string;
    paid_on: string | null;
    subtotal_cents: number; // sum of THIS PERSON'S own line amounts — safe to show
    lines: PayStubRow[];
  };
  const byRun = new Map<string, Period>();
  for (const r of rows) {
    let p = byRun.get(r.run_id);
    if (!p) {
      p = {
        run_id: r.run_id,
        period_start: r.period_start,
        period_end: r.period_end,
        paid_on: r.paid_on,
        subtotal_cents: 0,
        lines: [],
      };
      byRun.set(r.run_id, p);
    }
    p.lines.push(r);
    p.subtotal_cents += Number(r.amount_cents || 0);
  }
  // Newest period first (rows already arrive ordered by period_start desc).
  const periods = [...byRun.values()];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">{BRAND.name.charAt(0)}</div>
          <div className="wordmark">
            {BRAND.name}
            <small>{BRAND.tagline}</small>
          </div>
          <nav className="topnav">
            <Link className="navlink" href="/">
              Home
            </Link>
            <form action={signOut}>
              <button type="submit" className="navlink navbtn">
                Log out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="page">
        <p className="greeting">Your pay stubs</p>

        {periods.length === 0 && (
          <section className="card">
            <p className="intro" style={{ margin: 0 }}>No paid pay stubs yet.</p>
          </section>
        )}

        {periods.map((p) => (
          <section className="card" key={p.run_id}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h2 className="card-title" style={{ margin: 0 }}>
                  {periodLabel(p.period_start, p.period_end)}
                </h2>
                <div className="muted-cell" style={{ fontSize: 13, marginTop: 2 }}>
                  Paid {p.paid_on || "—"}
                </div>
              </div>
              <strong style={{ marginLeft: "auto" }}>{usdCents(p.subtotal_cents)}</strong>
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
                {p.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.project_name || "—"}</td>
                    <td className="right">{fmtHours(Number(l.hours || 0))}</td>
                    <td className="right">
                      {l.pay_rate != null
                        ? `$${Number(l.pay_rate).toFixed(2)}/h`
                        : <span className="muted-cell">—</span>}
                    </td>
                    <td className="right">{usdCents(Number(l.amount_cents || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}

        <p className="foot">{BRAND.name} Portal · {user.email}</p>
      </main>
    </>
  );
}
