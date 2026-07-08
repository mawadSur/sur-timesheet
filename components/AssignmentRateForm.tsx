"use client";

import { useActionState, useEffect, useState } from "react";
import { setAssignmentRate } from "@/app/actions";
import type { RateState } from "@/app/assignment-state";

// Per-assignment bill/pay rate editor with INLINE feedback (no navigation).
// The saved value PERSISTS: on success the action returns the authoritative
// stored row, and a useEffect syncs the inputs to it — so what's shown always
// equals what's stored (reflecting rounding / ignored-invalid / clear).
export default function AssignmentRateForm({
  assignmentId,
  billRate,
  payRate,
}: {
  assignmentId: string;
  billRate: number | null;
  payRate: number | null;
}) {
  const [state, formAction, pending] = useActionState(setAssignmentRate, {
    ok: false,
  } as RateState);
  const [bill, setBill] = useState(billRate == null ? "" : String(billRate));
  const [pay, setPay] = useState(payRate == null ? "" : String(payRate));
  const [dirty, setDirty] = useState(false);

  // On a successful save, sync inputs to the authoritative stored values and
  // clear the dirty flag so "Saved ✓" shows and the value persists.
  useEffect(() => {
    if (!state.savedAt) return;
    setBill(state.bill_rate == null ? "" : String(state.bill_rate));
    setPay(state.pay_rate == null ? "" : String(state.pay_rate));
    setDirty(false);
  }, [state.savedAt, state.bill_rate, state.pay_rate]);

  return (
    <form action={formAction} className="row-form">
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        Bill
        <input
          name="bill_rate"
          type="number"
          step="0.01"
          min="0"
          max="100000"
          placeholder="bill"
          title="Client bill rate per hour"
          value={bill}
          onChange={(e) => {
            setBill(e.target.value);
            setDirty(true);
          }}
          style={{ maxWidth: 72 }}
        />
      </label>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        Pay
        <input
          name="pay_rate"
          type="number"
          step="0.01"
          min="0"
          max="100000"
          placeholder="pay"
          title="Consultant pay rate per hour"
          value={pay}
          onChange={(e) => {
            setPay(e.target.value);
            setDirty(true);
          }}
          style={{ maxWidth: 72 }}
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
  );
}
