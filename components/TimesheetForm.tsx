"use client";

import { useMemo, useState } from "react";
import { submitTimesheet } from "@/app/actions";

export type ProjectOption = { id: string; name: string };
type Entry = { projectId: string; hours: string; notes: string };

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function blankEntry(projectId = ""): Entry {
  return { projectId, hours: "", notes: "" };
}

export default function TimesheetForm({
  projects,
}: {
  projects: ProjectOption[];
}) {
  const [date, setDate] = useState(todayISO());
  const [entries, setEntries] = useState<Entry[]>([
    blankEntry(projects[0]?.id ?? ""),
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<null | {
    date: string;
    count: number;
    total: number;
  }>(null);

  const total = useMemo(
    () => entries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0),
    [entries]
  );

  function updateEntry(i: number, patch: Partial<Entry>) {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }
  function addEntry() {
    const used = new Set(entries.map((e) => e.projectId));
    const next = projects.find((p) => !used.has(p.id));
    setEntries((prev) => [...prev, blankEntry(next?.id ?? "")]);
  }
  function removeEntry(i: number) {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  }
  function fillEightAll() {
    setEntries((prev) => prev.map((e) => ({ ...e, hours: "8" })));
  }

  async function submit() {
    setError("");
    const clean = entries
      .map((e) => ({
        projectId: e.projectId,
        hours: parseFloat(e.hours),
        notes: e.notes.trim(),
      }))
      .filter((e) => e.projectId && e.hours > 0);

    if (clean.length === 0) {
      setError("Add at least one project with hours greater than 0.");
      return;
    }
    const seen = new Set<string>();
    for (const e of clean) {
      if (seen.has(e.projectId)) {
        setError("A project is listed twice — combine it into one row.");
        return;
      }
      seen.add(e.projectId);
    }

    setSubmitting(true);
    const res = await submitTimesheet({ date, entries: clean });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error || "Something went wrong.");
      return;
    }
    setDone({
      date,
      count: clean.length,
      total: clean.reduce((s, e) => s + e.hours, 0),
    });
  }

  function reset() {
    setDone(null);
    setEntries([blankEntry(projects[0]?.id ?? "")]);
    setDate(todayISO());
  }

  if (projects.length === 0) {
    return (
      <div className="card">
        <div className="empty">
          <h2>No projects assigned yet</h2>
          <p>
            You haven&apos;t been assigned to any projects. Once your manager
            assigns you, they&apos;ll appear here and you can log hours.
          </p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card">
        <div className="success">
          <div className="check">✓</div>
          <h2>Hours submitted</h2>
          <p>Your time has been logged.</p>
          <div className="summary">
            <div className="summary-row">
              <span>Date</span>
              <span>{done.date}</span>
            </div>
            <div className="summary-row">
              <span>Projects logged</span>
              <span>{done.count}</span>
            </div>
            <div className="summary-row">
              <span>Total hours</span>
              <span>{done.total}</span>
            </div>
          </div>
          <button className="secondary" onClick={reset}>
            Log more hours
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <p className="intro">
        Choose your date and log hours across the projects you worked on.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="field">
        <label htmlFor="date">Date</label>
        <input
          id="date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      <div className="section-head">
        <h2>Projects &amp; hours</h2>
        <div className="section-actions">
          <button type="button" className="quick-fill" onClick={fillEightAll}>
            Set all to 8h
          </button>
          <span>{entries.length} added</span>
        </div>
      </div>

      {entries.map((entry, i) => (
        <div className="entry" key={i}>
          <div className="entry-grid">
            <div>
              <label>Project</label>
              <select
                value={entry.projectId}
                onChange={(e) => updateEntry(i, { projectId: e.target.value })}
              >
                <option value="">Select a project…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>Hours</label>
              <input
                type="number"
                min="0"
                step="0.25"
                inputMode="decimal"
                placeholder="0"
                value={entry.hours}
                onChange={(e) => updateEntry(i, { hours: e.target.value })}
              />
            </div>
          </div>
          <div className="entry-foot">
            <textarea
              placeholder="Notes (optional)"
              value={entry.notes}
              onChange={(e) => updateEntry(i, { notes: e.target.value })}
              rows={1}
            />
          </div>
          {entries.length > 1 && (
            <div style={{ textAlign: "right" }}>
              <button
                type="button"
                className="link-btn"
                onClick={() => removeEntry(i)}
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        className="add-btn"
        onClick={addEntry}
        disabled={entries.length >= projects.length}
      >
        + Add another project
      </button>

      <div className="total">
        <span>Total hours</span>
        <b>{total || 0}</b>
      </div>

      <button className="submit" onClick={submit} disabled={submitting}>
        {submitting ? "Submitting…" : "Submit timesheet"}
      </button>
    </div>
  );
}
