"use client";

import { useActionState, useEffect, useState } from "react";
import { assignProject } from "@/app/actions";
import type { AssignState } from "@/app/assignment-state";

// Assign a person to a project with INLINE feedback (no navigation). On success
// the two selects reset to their placeholder so the next assignment starts fresh.
export default function AssignPersonForm({
  people,
  projects,
}: {
  people: { id: string; full_name: string | null; email: string }[];
  projects: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(assignProject, {
    ok: false,
  } as AssignState);
  const [userId, setUserId] = useState("");
  const [projectId, setProjectId] = useState("");

  useEffect(() => {
    if (!state.savedAt) return;
    setUserId("");
    setProjectId("");
  }, [state.savedAt]);

  return (
    <form action={formAction} className="inline-form">
      <select
        name="user_id"
        required
        value={userId}
        onChange={(e) => setUserId(e.target.value)}
      >
        <option value="" disabled>
          Select person…
        </option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name ? `${p.full_name} (${p.email})` : p.email}
          </option>
        ))}
      </select>
      <select
        name="project_id"
        required
        value={projectId}
        onChange={(e) => setProjectId(e.target.value)}
      >
        <option value="" disabled>
          Select project…
        </option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Assigning…" : "Assign"}
      </button>
      {state.ok && !pending && (
        <span style={{ color: "var(--green)", fontSize: 13 }}>Assigned ✓</span>
      )}
      {state.error && (
        <span style={{ color: "var(--red)", fontSize: 13 }}>{state.error}</span>
      )}
    </form>
  );
}
