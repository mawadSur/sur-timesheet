"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getWeek, submitWeek, type WeekData } from "@/app/timesheet-actions";
import {
  addDays,
  formatHours,
  normalizeHours,
  sumHours,
  weekDays,
  weekRangeLabel,
} from "@/lib/week";

export type ProjectOption = { id: string; name: string };

/** Seven blank cells — every day, weekends included, starts at zero. */
const emptyRow = () => ["", "", "", "", "", "", ""];

/** Show a filter box once the list is long enough to scan (staff see them all). */
const FILTER_THRESHOLD = 8;

export default function WeeklyTimesheet({
  projects,
  initialWeek,
  maxWeekStart,
}: {
  projects: ProjectOption[];
  initialWeek: WeekData;
  /**
   * The current week as the SERVER sees it — the furthest week that may be
   * submitted. Passed down rather than recomputed here so a client whose clock
   * or timezone sits on the other side of midnight can't offer a week the
   * server will reject.
   */
  maxWeekStart: string;
}) {
  const [week, setWeek] = useState<WeekData>(initialWeek);
  const [hours, setHours] = useState<Record<string, string[]>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [justSubmitted, setJustSubmitted] = useState<null | "created" | "updated">(null);
  // Correcting an already-submitted current week, rather than filling a fresh one.
  const [editing, setEditing] = useState(false);

  const thisWeek = maxWeekStart;
  const days = useMemo(() => weekDays(week.weekStart), [week.weekStart]);
  const atCurrentWeek = week.weekStart >= thisWeek;
  // A submitted week is read-only unless the user has opened it for correction.
  // Only the week in progress can be reopened, and only until it has been paid
  // (`week.editable` folds both in — the server decides, and re-checks on save).
  const readOnly = week.submitted && !editing;
  const canEdit = week.submitted && week.editable;

  // Rows = every project available to log against, plus any project already
  // logged in this week that has since dropped off the list — otherwise those
  // hours would vanish from a submitted week and the total would misreport.
  const rows = useMemo(() => {
    const known = new Map(projects.map((p) => [p.id, p.name]));
    const extra = [...new Set(week.entries.map((e) => e.project_id))]
      .filter((id) => !known.has(id))
      .map((id) => ({ id, name: "Unlisted project" }));
    return [...projects, ...extra];
  }, [projects, week.entries]);

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) => p.name.toLowerCase().includes(q));
  }, [rows, filter]);

  // Rebuild the grid whenever the loaded week changes: submitted weeks render
  // the stored hours, an open week starts at zero everywhere.
  useEffect(() => {
    const nextHours: Record<string, string[]> = {};
    const nextNotes: Record<string, string> = {};
    for (const e of week.entries) {
      const idx = days.findIndex((d) => d.date === e.work_date);
      if (idx < 0) continue;
      if (!nextHours[e.project_id]) nextHours[e.project_id] = emptyRow();
      nextHours[e.project_id][idx] = formatHours(e.hours);
      if (e.notes && !nextNotes[e.project_id]) nextNotes[e.project_id] = e.notes;
    }
    setHours(nextHours);
    setNotes(nextNotes);
    setOpenNote(null);
    setEditing(false); // switching weeks always lands back in view mode
  }, [week, days]);

  const cellValue = (projectId: string, i: number) => hours[projectId]?.[i] ?? "";

  function setCell(projectId: string, i: number, value: string) {
    setHours((prev) => {
      const row = prev[projectId] ? [...prev[projectId]] : emptyRow();
      row[i] = value;
      return { ...prev, [projectId]: row };
    });
  }

  /** Fill Mon–Fri with 8h for one project; weekends stay at zero. */
  function fillWeekdays(projectId: string) {
    setHours((prev) => {
      const row = prev[projectId] ? [...prev[projectId]] : emptyRow();
      for (let i = 0; i < 5; i++) row[i] = "8";
      return { ...prev, [projectId]: row };
    });
  }

  const rowTotal = (projectId: string) =>
    sumHours((hours[projectId] ?? []).map((v) => normalizeHours(v)));

  const dayTotal = (i: number) =>
    sumHours(rows.map((p) => normalizeHours(cellValue(p.id, i))));

  const grandTotal = useMemo(
    () => sumHours(rows.map((p) => rowTotal(p.id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, hours]
  );

  // What the confirmation modal summarises, and what gets sent.
  const filled = useMemo(
    () =>
      rows
        .map((p) => ({ project: p, total: rowTotal(p.id) }))
        .filter((r) => r.total > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, hours]
  );
  const daysLogged = useMemo(
    () => days.filter((_, i) => dayTotal(i) > 0).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [days, hours, rows]
  );

  async function loadWeek(weekStart: string) {
    setError("");
    setJustSubmitted(null);
    setLoading(true);
    const res = await getWeek(weekStart);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setWeek(res.data);
  }

  function step(delta: number) {
    const next = addDays(week.weekStart, delta * 7);
    if (next > thisWeek) return; // never navigate into a week that hasn't started
    loadWeek(next);
  }

  async function confirmSubmit() {
    setError("");
    setSubmitting(true);
    const cells = rows.flatMap((p) =>
      days
        .map((d, i) => ({ projectId: p.id, date: d.date, hours: normalizeHours(cellValue(p.id, i)) }))
        .filter((c) => c.hours > 0)
    );
    const res = await submitWeek({ weekStart: week.weekStart, cells, notes });
    setSubmitting(false);
    setConfirming(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await loadWeek(week.weekStart); // re-read so the week renders as submitted
    setJustSubmitted(res.replaced ? "updated" : "created");
  }

  function openConfirm() {
    setError("");
    // An empty grid is only meaningful as a correction — clearing a week you
    // submitted by mistake returns it to unsubmitted.
    if (filled.length === 0 && !editing) {
      setError("Enter hours on at least one project before submitting.");
      return;
    }
    setConfirming(true);
  }

  if (rows.length === 0) {
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

  return (
    <section className="card week-card">
      <div className="week-bar">
        <button
          type="button"
          className="week-nav"
          onClick={() => step(-1)}
          disabled={loading}
          aria-label="Previous week"
        >
          ‹
        </button>
        <div className="week-label">
          <strong>{weekRangeLabel(week.weekStart)}</strong>
          <span>{atCurrentWeek ? "This week" : "Past week"}</span>
        </div>
        <button
          type="button"
          className="week-nav"
          onClick={() => step(1)}
          disabled={loading || atCurrentWeek}
          aria-label="Next week"
          title={atCurrentWeek ? "You can't log a week that hasn't started" : undefined}
        >
          ›
        </button>

        <div className="week-bar-end">
          {!atCurrentWeek && (
            <button type="button" className="link-btn" onClick={() => loadWeek(thisWeek)}>
              Jump to this week
            </button>
          )}
          <span className={`badge ${readOnly ? "badge-ok" : ""}`}>
            {readOnly ? "Submitted" : "Not submitted"}
          </span>
        </div>
      </div>

      {justSubmitted && (
        <div className="alert alert-ok">
          Timesheet {justSubmitted === "updated" ? "updated" : "submitted"} for{" "}
          {weekRangeLabel(week.weekStart)}.
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}

      {readOnly && (
        <div className="week-note">
          {canEdit ? (
            <>
              <p className="intro">
                Submitted. Spotted a mistake? You can still change this week
                until it&apos;s paid.
              </p>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
                Edit hours
              </button>
            </>
          ) : (
            <p className="intro">
              {week.locked
                ? "This week has been paid and can no longer be changed. Contact an admin if something looks wrong."
                : "This week has closed and is read-only. Contact an admin if something needs to change."}
            </p>
          )}
        </div>
      )}
      {editing && (
        <p className="intro week-note">
          Editing this week. Submitting replaces what you logged earlier.
        </p>
      )}

      {rows.length > FILTER_THRESHOLD && !readOnly && (
        <div className="week-filter">
          <input
            type="search"
            placeholder={`Filter ${rows.length} projects…`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter projects"
          />
        </div>
      )}

      <div className="grid-scroll" aria-busy={loading}>
        <table className="week-grid">
          <thead>
            <tr>
              <th className="proj-col">Project</th>
              {days.map((d) => (
                <th key={d.date} className={d.weekend ? "weekend" : undefined} scope="col">
                  <span className="dname">{d.name}</span>
                  <span className="dnum">{d.dayOfMonth}</span>
                </th>
              ))}
              <th className="tot-col" scope="col">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((p) => (
              <RowGroup
                key={p.id}
                project={p}
                days={days}
                readOnly={readOnly}
                value={(i) => cellValue(p.id, i)}
                onChange={(i, v) => setCell(p.id, i, v)}
                total={rowTotal(p.id)}
                note={notes[p.id] ?? ""}
                noteOpen={openNote === p.id}
                onToggleNote={() => setOpenNote(openNote === p.id ? null : p.id)}
                onNote={(v) => setNotes((prev) => ({ ...prev, [p.id]: v }))}
                onFill={() => fillWeekdays(p.id)}
              />
            ))}
            {visibleRows.length === 0 && (
              <tr>
                <td className="no-match" colSpan={days.length + 2}>
                  No projects match “{filter}”.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th className="proj-col" scope="row">
                Daily total
              </th>
              {days.map((d, i) => (
                <td key={d.date} className={d.weekend ? "weekend" : undefined}>
                  {formatHours(dayTotal(i))}
                </td>
              ))}
              <td className="tot-col grand">{formatHours(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="total">
        <span>Total hours</span>
        <b>{formatHours(grandTotal)}</b>
      </div>

      {!readOnly && (
        <div className="week-actions">
          {editing && (
            <button
              type="button"
              className="secondary"
              onClick={() => loadWeek(week.weekStart)}
              disabled={submitting || loading}
            >
              Cancel
            </button>
          )}
          <button className="submit" onClick={openConfirm} disabled={submitting || loading}>
            {loading ? "Loading…" : editing ? "Update timesheet" : "Submit timesheet"}
          </button>
        </div>
      )}

      {confirming && (
        <ConfirmModal
          weekLabel={weekRangeLabel(week.weekStart)}
          filled={filled}
          daysLogged={daysLogged}
          total={grandTotal}
          replacing={editing}
          submitting={submitting}
          onCancel={() => setConfirming(false)}
          onConfirm={confirmSubmit}
        />
      )}
    </section>
  );
}

/** One project: the seven day inputs, its total, and an optional note row. */
function RowGroup({
  project,
  days,
  readOnly,
  value,
  onChange,
  total,
  note,
  noteOpen,
  onToggleNote,
  onNote,
  onFill,
}: {
  project: ProjectOption;
  days: ReturnType<typeof weekDays>;
  readOnly: boolean;
  value: (i: number) => string;
  onChange: (i: number, v: string) => void;
  total: number;
  note: string;
  noteOpen: boolean;
  onToggleNote: () => void;
  onNote: (v: string) => void;
  onFill: () => void;
}) {
  return (
    <>
      <tr>
        <th className="proj-col" scope="row">
          <span className="proj-name">{project.name}</span>
          <span className="proj-tools">
            {!readOnly && (
              <button type="button" className="link-btn" onClick={onFill} title="Fill Mon–Fri with 8h">
                8h × 5
              </button>
            )}
            {(!readOnly || note) && (
              <button
                type="button"
                className={`link-btn${note ? " has-note" : ""}`}
                onClick={onToggleNote}
                aria-expanded={noteOpen}
              >
                {note ? "Note •" : "Note"}
              </button>
            )}
          </span>
        </th>
        {days.map((d, i) => (
          <td key={d.date} className={d.weekend ? "weekend" : undefined}>
            {readOnly ? (
              <span className={`ro-cell${value(i) ? "" : " zero"}`}>{value(i) || "0"}</span>
            ) : (
              <input
                type="number"
                min="0"
                max="24"
                step="0.25"
                inputMode="decimal"
                placeholder="0"
                value={value(i)}
                onChange={(e) => onChange(i, e.target.value)}
                aria-label={`${project.name} — ${d.name} ${d.dayOfMonth}`}
              />
            )}
          </td>
        ))}
        <td className="tot-col">{formatHours(total)}</td>
      </tr>
      {noteOpen && (
        <tr className="note-row">
          <td colSpan={days.length + 2}>
            {readOnly ? (
              <p className="ro-note">{note || "—"}</p>
            ) : (
              <textarea
                rows={2}
                placeholder={`Notes for ${project.name} (optional)`}
                value={note}
                onChange={(e) => onNote(e.target.value)}
              />
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Pre-submit summary: what's about to be logged, and that it locks after. */
function ConfirmModal({
  weekLabel,
  filled,
  daysLogged,
  total,
  replacing,
  submitting,
  onCancel,
  onConfirm,
}: {
  weekLabel: string;
  filled: { project: ProjectOption; total: number }[];
  daysLogged: number;
  total: number;
  replacing: boolean;
  submitting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, submitting]);

  return (
    <div className="modal-scrim" onClick={() => !submitting && onCancel()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">
          {replacing ? "Confirm your changes" : "Confirm your timesheet"}
        </h2>
        <p className="modal-sub">{weekLabel}</p>

        <div className="summary">
          <div className="summary-row">
            <span>Projects</span>
            <span>{filled.length}</span>
          </div>
          <div className="summary-row">
            <span>Days logged</span>
            <span>{daysLogged}</span>
          </div>
          <div className="summary-row">
            <span>Total hours</span>
            <span>{formatHours(total)}</span>
          </div>
        </div>

        {filled.length > 0 ? (
          <table className="tbl modal-tbl">
            <thead>
              <tr>
                <th>Project</th>
                <th className="right">Hours</th>
              </tr>
            </thead>
            <tbody>
              {filled.map((r) => (
                <tr key={r.project.id}>
                  <td>{r.project.name}</td>
                  <td className="right">{formatHours(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="modal-warn">
            Every cell is empty — confirming clears this week entirely and
            returns it to unsubmitted.
          </p>
        )}

        <p className="modal-warn">
          {replacing
            ? "This replaces what you logged earlier for this week. You can keep changing it until the week is paid."
            : "You can still correct this week until it's paid. After that it becomes read-only."}
        </p>

        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onCancel} disabled={submitting}>
            Back
          </button>
          <button
            type="button"
            className="submit"
            ref={confirmRef}
            onClick={onConfirm}
            disabled={submitting}
          >
            {submitting
              ? "Saving…"
              : replacing
                ? "Confirm & update"
                : "Confirm & submit"}
          </button>
        </div>
      </div>
    </div>
  );
}
