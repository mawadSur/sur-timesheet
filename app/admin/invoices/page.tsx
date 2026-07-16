import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { generateInvoice } from "@/app/invoice-actions";
import { usdCents } from "@/lib/books";

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
    case "sent":
      return { background: "#e7eefc", color: "#1d4ed8", border: "1px solid #bcd0f7" };
    case "void":
      return { background: "#eef0f2", color: "#5b6470", border: "1px solid #d6dade" };
    default: // draft
      return { background: "#fff5e0", color: "#a15c00", border: "1px solid #f3d8a0" };
  }
}

export default async function Invoices() {
  const supabase = await createClient();
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const todayMs = Date.parse(now.toISOString().slice(0, 10));

  const [{ data: invoices }, { data: projects }] = await Promise.all([
    supabase
      .from("invoices")
      .select("id, invoice_number, status, period_start, period_end, total_cents, amount_received_cents, due_on, projects(name)")
      .order("created_at", { ascending: false }),
    supabase.from("projects").select("id, name").order("name"),
  ]);

  const list = (invoices ?? []) as any[];

  // AR aging over sent (unpaid) invoices, by days past due.
  const buckets = { current: 0, d1: 0, d2: 0, d3: 0, d4: 0 };
  let outstanding = 0;
  for (const inv of list) {
    if (inv.status !== "sent") continue;
    const owed = Number(inv.total_cents || 0) - Number(inv.amount_received_cents || 0);
    if (owed <= 0) continue;
    outstanding += owed;
    const past = inv.due_on ? Math.floor((todayMs - Date.parse(inv.due_on)) / 86400000) : 0;
    if (past <= 0) buckets.current += owed;
    else if (past <= 30) buckets.d1 += owed;
    else if (past <= 60) buckets.d2 += owed;
    else if (past <= 90) buckets.d3 += owed;
    else buckets.d4 += owed;
  }

  const tile: React.CSSProperties = { border: "1px solid #e3e7ec", borderRadius: 12, padding: 14, background: "#fff" };
  const tileLabel: React.CSSProperties = { fontSize: 11.5, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6470", fontWeight: 600 };
  const tileValue: React.CSSProperties = { fontSize: 20, fontWeight: 700, marginTop: 6 };

  return (
    <>
      <main className="page admin">
        {/* ── AR aging ─────────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">
            Accounts receivable{" "}
            <span className="count-pill">{usdCents(outstanding)} outstanding</span>
          </h2>
          <p className="intro">What clients owe you on sent invoices, aged by how far past due.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
            <div style={tile}><div style={tileLabel}>Not yet due</div><div style={tileValue}>{usdCents(buckets.current)}</div></div>
            <div style={tile}><div style={tileLabel}>1–30 days</div><div style={tileValue}>{usdCents(buckets.d1)}</div></div>
            <div style={tile}><div style={tileLabel}>31–60 days</div><div style={tileValue}>{usdCents(buckets.d2)}</div></div>
            <div style={tile}><div style={tileLabel}>61–90 days</div><div style={tileValue}>{usdCents(buckets.d3)}</div></div>
            <div style={tile}><div style={{ ...tileValue, color: buckets.d4 > 0 ? "var(--red)" : undefined }}>{usdCents(buckets.d4)}</div><div style={tileLabel}>90+ days</div></div>
          </div>
        </section>

        {/* ── Generate ─────────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">Generate an invoice</h2>
          <p className="intro">Creates a draft for a project&apos;s billable hours in a month. Only billable time (both rates set) is included.</p>
          <form action={generateInvoice} className="inline-form">
            <select name="project_id" required defaultValue="">
              <option value="" disabled>Select project…</option>
              {(projects ?? []).map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <input type="month" name="month" defaultValue={thisMonth} required />
            <button type="submit" className="btn">Generate draft</button>
          </form>
        </section>

        {/* ── All invoices ─────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">All invoices</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Project</th>
                <th>Period</th>
                <th>Status</th>
                <th className="right">Total</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {list.map((inv) => (
                <tr key={inv.id}>
                  <td>
                    <Link href={`/admin/invoices/${inv.id}`}>{inv.invoice_number || "Draft"}</Link>
                  </td>
                  <td>{inv.projects?.name ?? "—"}</td>
                  <td className="muted-cell">{inv.period_start} → {inv.period_end}</td>
                  <td><span style={{ ...badgeBase, ...statusStyle(inv.status) }}>{inv.status}</span></td>
                  <td className="right">{usdCents(Number(inv.total_cents || 0))}</td>
                  <td className="muted-cell">{inv.due_on || "—"}</td>
                </tr>
              ))}
              {list.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted-cell">No invoices yet. Generate one above.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
