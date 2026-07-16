import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { usdCents } from "@/lib/books";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Derive a human label like "Jul 1–15, 2026" from a period's start/end dates.
function periodLabel(start: string, end: string): string {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  if (sy === ey && sm === em) return `${MONTHS[sm - 1]} ${sd}–${ed}, ${sy}`;
  return `${MONTHS[sm - 1]} ${sd}, ${sy} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
}

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
    default: // draft
      return { background: "#fff5e0", color: "#a15c00", border: "1px solid #f3d8a0" };
  }
}

export default async function PayrollRuns() {
  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("payroll_runs")
    .select("id, period_key, period_start, period_end, status, total_cents, paid_on")
    .order("created_at", { ascending: false });

  const list = (runs ?? []) as any[];

  return (
    <>
      <main className="page admin">
        <section className="card">
          <h2 className="card-title">Payroll runs</h2>
          <p className="intro">
            Finalized contractor payouts, one per pay period. A run freezes what each
            contractor is owed so it can be marked paid as a record of what was actually
            paid out. Create one from the <Link href="/admin/payroll">Payroll</Link> page.
          </p>
          <table className="tbl">
            <thead>
              <tr>
                <th>Period</th>
                <th>Status</th>
                <th className="right">Total</th>
                <th>Paid on</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/payroll/runs/${r.id}`}>{periodLabel(r.period_start, r.period_end)}</Link>
                  </td>
                  <td><span style={{ ...badgeBase, ...statusStyle(r.status) }}>{r.status}</span></td>
                  <td className="right">{usdCents(Number(r.total_cents || 0))}</td>
                  <td className="muted-cell">{r.paid_on || "—"}</td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted-cell">
                    No payroll runs yet. Finalize one from the Payroll page.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p style={{ marginTop: 12 }}>
            <Link className="navlink" href="/admin/payroll">← Back to Payroll</Link>
          </p>
        </section>
      </main>
    </>
  );
}
