"use client";

import { useActionState } from "react";
import { unassignProject } from "@/app/actions";
import type { UnassignState } from "@/app/assignment-state";

// Remove an assignment with INLINE feedback (no navigation). On success the row
// is dropped by revalidatePath, so only the failure path needs to show anything.
export default function UnassignButton({
  assignmentId,
}: {
  assignmentId: string;
}) {
  const [state, formAction, pending] = useActionState(unassignProject, {
    ok: false,
  } as UnassignState);

  return (
    <form action={formAction} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <input type="hidden" name="assignment_id" value={assignmentId} />
      <button type="submit" className="link-btn" disabled={pending}>
        {pending ? "Removing…" : "Unassign"}
      </button>
      {state.error && (
        <span style={{ color: "var(--red)", fontSize: 13 }}>{state.error}</span>
      )}
    </form>
  );
}
