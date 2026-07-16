"use client";

import { useActionState, useEffect, useState } from "react";
import { setAssignmentRate } from "@/app/actions";
import type { RateState } from "@/app/assignment-state";

type HistoryRow = {
  effective_from: string;
  bill_rate: number | null;
  pay_rate: number | null;
};

const fmtRate = (n: number | null) => (n == null ? "—" : `$${n}`);

// Per-assignment bill/pay rate editor with INLINE feedback (no navigation).
// The saved value PERSISTS: on success the action returns the authoritative
// stored row, and a useEffect syncs the inputs to it — so what's shown always
// equals what's stored (reflecting rounding / ignored-invalid / clear).
//
// "Effective from" lets an admin back-date a row to CORRECT a past rate; blank
// means today. The rate history below shows every dated row (newest first).
//
// The inputs are PRE-FILLED with today's latest rate for convenience, but a
// field the admin never edits is NOT submitted (its `name` is omitted) — so the
// server carries forward that field's real value AS OF the chosen date instead
// of overwriting it with the pre-filled number. This makes a back-dated one-field
// correction (e.g. fix January's bill) leave the OTHER rate's history intact.
export default function AssignmentRateForm({
  assignmentId,
  billRate,
  payRate,
  history = [],
}: {
  assignmentId: string;
  billRate: number | null;
  payRate: number | null;
  history?: HistoryRow[];
}) {
  const [state, formAction, pending] = useActionState(setAssignmentRate, {
    ok: false,
  } as RateState);
  const [bill, setBill] = useState(billRate == null ? "" : String(billRate));
  const [pay, setPay] = useState(payRate == null ? "" : String(payRate));
  // Per-field dirty tracking: only fields the admin actually edited are
  // submitted; untouched fields carry forward server-side (see setAssignmentRate).
  const [billDirty, setBillDirty] = useState(false);
  const [payDirty, setPayDirty] = useState(false);
  const [dateDirty, setDateDirty] = useState(false);
  const dirty = billDirty || payDirty || dateDirty;

  // On a successful save, sync inputs to the authoritative stored values and
  // clear the dirty flags so "Saved ✓" shows and the value persists.
  useEffect(() => {
    if (!state.savedAt) return;
    setBill(state.bill_rate == null ? "" : String(state.bill_rate));
    setPay(state.pay_rate == null ? "" : String(state.pay_rate));
    setBillDirty(false);
    setPayDirty(false);
    setDateDirty(false);
  }, [state.savedAt, state.bill_rate, state.pay_rate]);

  return (
    <div className="stack-form" style={{ gap: 6 }}>
      <form action={formAction} className="row-form">
        <input type="hidden" name="assignment_id" value={assignmentId} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          Bill
          <input
            name={billDirty ? "bill_rate" : undefined}
            type="number"
            step="0.01"
            min="0"
            max="100000"
            placeholder="bill"
            title="Client bill rate per hour"
            value={bill}
            onChange={(e) => {
              setBill(e.target.value);
              setBillDirty(true);
            }}
            style={{ maxWidth: 72 }}
          />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          Pay
          <input
            name={payDirty ? "pay_rate" : undefined}
            type="number"
            step="0.01"
            min="0"
            max="100000"
            placeholder="pay"
            title="Consultant pay rate per hour"
            value={pay}
            onChange={(e) => {
              setPay(e.target.value);
              setPayDirty(true);
            }}
            style={{ maxWidth: 72 }}
          />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          Effective from
          <input
            name="effective_from"
            type="date"
            title="Leave blank for today, or back-date to correct a past rate"
            onChange={() => setDateDirty(true)}
            style={{ maxWidth: 150 }}
          />
        </label>
        <button type="submit" className="btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        {state.ok && !dirty && !pending && (
          <span style={{ color: "var(--green)", fontSize: 13 }}>Saved ✓</span>
        )}
        {state.error && (
          <span style={{ color: "var(--red)", fontSize: 13 }}>{state.error}</span>
        )}
      </form>
      <span className="muted-cell" style={{ fontSize: 11 }}>
        Leave blank for today, or back-date to correct a past rate.
      </span>
      {history.length > 0 && (
        <ul
          className="muted-cell"
          style={{ listStyle: "none", margin: 0, padding: 0, fontSize: 12 }}
        >
          {history.map((h) => (
            <li key={h.effective_from}>
              {h.effective_from} → bill {fmtRate(h.bill_rate)} / pay{" "}
              {fmtRate(h.pay_rate)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
