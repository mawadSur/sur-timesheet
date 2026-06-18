"use client";

import { useMemo, useState } from "react";
import {
  BRAND,
  EMPLOYEES,
  projectsForEmployee,
} from "@/config/timesheet";

type Entry = { project: string; hours: string; notes: string };

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function blankEntry(project = ""): Entry {
  return { project, hours: "", notes: "" };
}

export default function Home() {
  const [employee, setEmployee] = useState("");
  const [date, setDate] = useState(todayISO());
  const [entries, setEntries] = useState<Entry[]>([blankEntry()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<null | {
    employee: string;
    date: string;
    count: number;
    total: number;
  }>(null);

  const availableProjects = useMemo(
    () => (employee ? projectsForEmployee(employee) : []),
    [employee]
  );

  const total = useMemo(
    () =>
      entries.reduce((sum, e) => sum + (parseFloat(e.hours) || 0), 0),
    [entries]
  );

  function onEmployeeChange(name: string) {
    setEmployee(name);
    setError("");
    // Reset entries to a single row defaulting to their first project.
    const projs = name ? projectsForEmployee(name) : [];
    setEntries([blankEntry(projs[0] ?? "")]);
  }

  function updateEntry(i: number, patch: Partial<Entry>) {
    setEntries((prev) =>
      prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e))
    );
  }

  function addEntry() {
    const used = new Set(entries.map((e) => e.project));
    const next = availableProjects.find((p) => !used.has(p)) ?? "";
    setEntries((prev) => [...prev, blankEntry(next)]);
  }

  function removeEntry(i: number) {
    setEntries((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function submit() {
    setError("");

    if (!employee) {
      setError("Please select your name.");
      return;
    }
    const clean = entries
      .map((e) => ({
        project: e.project.trim(),
        hours: parseFloat(e.hours),
        notes: e.notes.trim(),
      }))
      .filter((e) => e.project && e.hours > 0);

    if (clean.length === 0) {
      setError("Add at least one project with hours greater than 0.");
      return;
    }
    const dupes = new Set();
    for (const e of clean) {
      if (dupes.has(e.project)) {
        setError(`"${e.project}" is listed twice — combine it into one row.`);
        return;
      }
      dupes.add(e.project);
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee, date, entries: clean }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(
          data.error || "Could not save your timesheet. Please try again."
        );
      }
      setDone({
        employee,
        date,
        count: clean.length,
        total: clean.reduce((s, e) => s + e.hours, 0),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setDone(null);
    setEntries([blankEntry(availableProjects[0] ?? "")]);
    setDate(todayISO());
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">{BRAND.name.charAt(0)}</div>
          <div className="wordmark">
            {BRAND.name}
            <small>{BRAND.tagline}</small>
          </div>
        </div>
      </header>

      <main className="page">
        <div className="card">
          {done ? (
            <div className="success">
              <div className="check">✓</div>
              <h2>Hours submitted</h2>
              <p>Thanks, {done.employee.split(" ")[0]} — your time is logged.</p>
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
          ) : (
            <>
              <p className="intro">
                Select your name, choose your date, and log your hours across the
                projects you worked on.
              </p>

              {error && <div className="alert alert-error">{error}</div>}

              <div className="field-row">
                <div className="field">
                  <label htmlFor="employee">Your name</label>
                  <select
                    id="employee"
                    value={employee}
                    onChange={(e) => onEmployeeChange(e.target.value)}
                  >
                    <option value="">Select your name…</option>
                    {EMPLOYEES.map((e) => (
                      <option key={e.name} value={e.name}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="date">Date</label>
                  <input
                    id="date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="section-head">
                <h2>Projects &amp; hours</h2>
                <span>{entries.length} added</span>
              </div>

              {entries.map((entry, i) => (
                <div className="entry" key={i}>
                  <div className="entry-grid">
                    <div>
                      <label>Project</label>
                      <select
                        value={entry.project}
                        disabled={!employee}
                        onChange={(e) =>
                          updateEntry(i, { project: e.target.value })
                        }
                      >
                        <option value="">
                          {employee ? "Select a project…" : "Pick your name first"}
                        </option>
                        {availableProjects.map((p) => (
                          <option key={p} value={p}>
                            {p}
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
                        disabled={!employee}
                        onChange={(e) =>
                          updateEntry(i, { hours: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div className="entry-foot">
                    <textarea
                      placeholder="Notes (optional)"
                      value={entry.notes}
                      disabled={!employee}
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
                disabled={!employee || entries.length >= availableProjects.length}
              >
                + Add another project
              </button>

              <div className="total">
                <span>Total hours</span>
                <b>{total || 0}</b>
              </div>

              <button
                className="submit"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? "Submitting…" : "Submit timesheet"}
              </button>
            </>
          )}
        </div>
        <p className="foot">
          {BRAND.name} Timesheet · your hours are saved to the company record
          {"  ·  "}
          <button type="button" className="logout" onClick={logout}>
            Log out
          </button>
        </p>
      </main>
    </>
  );
}
