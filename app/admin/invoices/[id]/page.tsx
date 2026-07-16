import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  sendInvoice,
  regenerateInvoice,
  markInvoicePaid,
  voidInvoice,
  updateInvoice,
  deleteInvoice,
} from "@/app/invoice-actions";
import {
  usdCents,
  buildRateHistoryByPair,
  billableInvoiceLines,
  fetchAllRows,
} from "@/lib/books";
import PrintButton from "@/components/PrintButton";

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
    default:
      return { background: "#fff5e0", color: "#a15c00", border: "1px solid #f3d8a0" };
  }
}

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: inv } = await supabase
    .from("invoices")
    .select("*, projects(name)")
    .eq("id", id)
    .single();
  if (!inv) notFound();

  const isDraft = inv.status === "draft";

  // Draft: compute lines live from timesheets. Sent/paid/void: use the frozen
  // snapshot. For a sent invoice we also recompute live to detect drift.
  let lines: any[] = [];
  let subtotalCents = Number(inv.subtotal_cents || 0);
  let liveSubtotal: number | null = null;

  if (isDraft || inv.status === "sent") {
    const [rows, { data: assignments }, { data: rates }] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("timesheets")
          .select("work_date, user_id, project_id, hours, profiles(full_name, email)")
          .eq("project_id", inv.project_id)
          .gte("work_date", inv.period_start)
          .lte("work_date", inv.period_end)
          .order("id")
          .range(from, to)
      ),
      supabase.from("assignments").select("id, user_id, project_id").eq("project_id", inv.project_id),
      supabase.from("assignment_rates").select("assignment_id, bill_rate, pay_rate, effective_from"),
    ]);
    const live = billableInvoiceLines(rows, buildRateHistoryByPair(assignments, rates));
    liveSubtotal = live.reduce((s, l) => s + l.amount_cents, 0);
    if (isDraft) {
      lines = live.map((l) => ({
        description: `${l.name} — ${l.hours} h @ $${l.bill_rate.toFixed(2)}/h`,
        hours: l.hours,
        bill_rate: l.bill_rate,
        amount_cents: l.amount_cents,
      }));
      subtotalCents = liveSubtotal;
    }
  }

  if (!isDraft) {
    const { data: storedLines } = await supabase
      .from("invoice_lines")
      .select("*")
      .eq("invoice_id", id)
      .order("amount_cents", { ascending: false });
    lines = storedLines ?? [];
  }

  const adjustmentCents = Number(inv.adjustment_cents || 0);
  const totalCents = subtotalCents + adjustmentCents;
  const drift = inv.status === "sent" && liveSubtotal != null && liveSubtotal !== Number(inv.subtotal_cents || 0);

  // A partial payment records what's been received but keeps the invoice 'sent'
  // (still outstanding). Surface how much is still owed.
  const receivedCents = Number(inv.amount_received_cents || 0);
  const balanceDueCents = totalCents - receivedCents;
  const isPartiallyPaid = inv.status === "sent" && receivedCents > 0;

  return (
    <>
      <style>{`@media print { .topbar, .no-print { display: none !important; } .page { padding-top: 20px; } }`}</style>
      <main className="page admin">
        <Breadcrumbs
          items={[
            { label: "Invoices", href: "/admin/invoices" },
            { label: inv.invoice_number ? `#${inv.invoice_number}` : "Draft invoice" },
          ]}
        />
        {drift && (
          <section className="card no-print" style={{ borderLeft: "4px solid #f79009" }}>
            <p className="intro" style={{ margin: 0 }}>
              ⚠️ Timesheets for this period changed since this invoice was sent. Its snapshot still
              shows {usdCents(Number(inv.subtotal_cents || 0))}; current billable hours would total{" "}
              {usdCents(liveSubtotal!)}. The sent invoice is intentionally frozen and not rewritten.
            </p>
          </section>
        )}

        {/* ── The invoice itself (printable) ───────────────────────── */}
        <section className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 className="card-title" style={{ marginBottom: 4 }}>{inv.invoice_number || "Draft invoice"}</h2>
              <div style={{ color: "#5b6470", fontSize: 14 }}>
                {inv.projects?.name} · {inv.period_start} → {inv.period_end}
              </div>
            </div>
            <span style={{ ...badgeBase, ...statusStyle(inv.status) }}>{inv.status}</span>
          </div>

          <div style={{ display: "flex", gap: 40, flexWrap: "wrap", marginTop: 14, fontSize: 14 }}>
            <div>
              <div style={{ color: "#5b6470", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>Bill to</div>
              <div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{inv.bill_to || "—"}</div>
            </div>
            <div>
              <div style={{ color: "#5b6470", fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>Dates</div>
              <div style={{ marginTop: 4 }}>
                Issued: {inv.issued_on || "—"}<br />
                Due: {inv.due_on || "—"}{inv.paid_on ? <><br />Paid: {inv.paid_on}</> : null}
              </div>
            </div>
          </div>

          <table className="tbl" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Description</th>
                <th className="right">Hours</th>
                <th className="right">Rate</th>
                <th className="right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l: any, i: number) => (
                <tr key={i}>
                  <td>{l.description}</td>
                  <td className="right">{l.hours}</td>
                  <td className="right">${Number(l.bill_rate).toFixed(2)}</td>
                  <td className="right">{usdCents(Number(l.amount_cents))}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr><td colSpan={4} className="muted-cell">No billable hours for this project this period.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="right"><strong>Subtotal</strong></td>
                <td className="right">{usdCents(subtotalCents)}</td>
              </tr>
              {adjustmentCents !== 0 && (
                <tr>
                  <td colSpan={3} className="right">Adjustment</td>
                  <td className="right">{usdCents(adjustmentCents)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3} className="right"><strong>Total</strong></td>
                <td className="right"><strong>{usdCents(totalCents)}</strong></td>
              </tr>
              {isPartiallyPaid && (
                <>
                  <tr>
                    <td colSpan={3} className="right">Amount received{inv.paid_on ? ` (${inv.paid_on})` : ""}</td>
                    <td className="right">{usdCents(-receivedCents)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="right"><strong>Balance due</strong></td>
                    <td className="right"><strong>{usdCents(balanceDueCents)}</strong></td>
                  </tr>
                </>
              )}
            </tfoot>
          </table>

          {inv.notes && <p style={{ marginTop: 12, whiteSpace: "pre-wrap", fontSize: 14 }}>{inv.notes}</p>}

          <div className="no-print" style={{ marginTop: 14 }}>
            <PrintButton />
          </div>
        </section>

        {/* ── Admin controls (never printed) ───────────────────────── */}
        {inv.status !== "void" && (
          <section className="card no-print">
            <h2 className="card-title">Actions</h2>

            {(isDraft || inv.status === "sent") && (
              <form action={updateInvoice} className="stack-form" style={{ marginBottom: 16 }}>
                <input type="hidden" name="id" value={inv.id} />
                <div className="field-row">
                  <div className="field">
                    <label>Bill to</label>
                    <input name="bill_to" defaultValue={inv.bill_to || ""} placeholder="Client name / address" />
                  </div>
                  <div className="field">
                    <label>Adjustment ($, +/-)</label>
                    <input name="adjustment" type="number" step="0.01" defaultValue={(adjustmentCents / 100).toString()} />
                  </div>
                </div>
                <div className="field">
                  <label>Notes</label>
                  <input name="notes" defaultValue={inv.notes || ""} placeholder="Payment terms, PO number, etc." />
                </div>
                <button type="submit" className="btn-sm">Save details</button>
              </form>
            )}

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {isDraft && (
                <>
                  <form action={regenerateInvoice}>
                    <input type="hidden" name="id" value={inv.id} />
                    <button type="submit" className="btn-sm">Refresh from timesheets</button>
                  </form>
                  <form action={sendInvoice}>
                    <input type="hidden" name="id" value={inv.id} />
                    <button type="submit" className="btn">Mark as sent</button>
                  </form>
                  <form action={deleteInvoice}>
                    <input type="hidden" name="id" value={inv.id} />
                    <button type="submit" className="link-btn">Delete draft</button>
                  </form>
                </>
              )}

              {inv.status === "sent" && (
                <>
                  {isPartiallyPaid && (
                    <span className="badge" title="A partial payment has been recorded; this invoice is still open">
                      {usdCents(receivedCents)} received · {usdCents(balanceDueCents)} balance due
                    </span>
                  )}
                  <form action={markInvoicePaid} className="row-form">
                    <input type="hidden" name="id" value={inv.id} />
                    <input name="paid_on" type="date" title="Date paid (defaults to today)" />
                    <input name="amount_received" type="number" step="0.01" placeholder="amount recd" title="Amount received (defaults to full total)" style={{ maxWidth: 120 }} />
                    <button type="submit" className="btn">Mark as paid</button>
                  </form>
                  <form action={voidInvoice}>
                    <input type="hidden" name="id" value={inv.id} />
                    <button type="submit" className="link-btn">Void</button>
                  </form>
                </>
              )}

              {inv.status === "paid" && (
                <span className="badge badge-ok">
                  Paid {inv.paid_on} · received {usdCents(Number(inv.amount_received_cents || 0))}
                </span>
              )}
            </div>
          </section>
        )}
      </main>
    </>
  );
}
