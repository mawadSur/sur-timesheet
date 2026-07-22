"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit";
import {
  currentWeekStart,
  isInWeek,
  isMonday,
  isValidISODate,
  normalizeHours,
  sumHours,
  weekEnd,
} from "@/lib/week";

// Server actions for the weekly timesheet grid. Reads are RLS-scoped to the
// caller (timesheets_select is `user_id = auth.uid()`), and the insert is
// additionally gated by timesheets_insert — staff may book any project,
// employees only their assigned ones. Everything here re-validates the week
// server-side so a hand-rolled request can't log a future week or a 30-hour day.

export type WeekEntry = {
  project_id: string;
  work_date: string;
  hours: number;
  notes: string | null;
};

export type WeekData = {
  weekStart: string;
  /** A week with any logged row counts as submitted. */
  submitted: boolean;
  /**
   * True once any hour in this week sits inside a paid invoice or paid payroll
   * run. Editing closes at that point — before it, the current week can still
   * be corrected. Past weeks are read-only regardless.
   */
  locked: boolean;
  /** Whether this is the week currently in progress (the only editable one). */
  editable: boolean;
  entries: WeekEntry[];
};

export type WeekCell = { projectId: string; date: string; hours: number };

export type SubmitWeekPayload = {
  weekStart: string;
  cells: WeekCell[];
  /** Optional per-project note, copied onto each of that project's rows. */
  notes?: Record<string, string>;
};

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const MAX_HOURS_PER_DAY = 24;

/**
 * Validate a week-start the same way in both actions: a real Monday, and never
 * a week that hasn't begun yet. ISO dates compare correctly as strings.
 */
function checkWeekStart(weekStart: string): string | null {
  if (!isValidISODate(weekStart) || !isMonday(weekStart)) {
    return "Invalid week.";
  }
  if (weekStart > currentWeekStart()) {
    return "That week hasn't started yet.";
  }
  return null;
}

/** Load the caller's own rows for one week, plus whether it's already submitted. */
export async function getWeek(weekStart: string): Promise<Result<WeekData>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — please sign in again." };

  const bad = checkWeekStart(weekStart);
  if (bad) return { ok: false, error: bad };

  const { data, error } = await supabase
    .from("timesheets")
    .select("project_id, work_date, hours, notes")
    .eq("user_id", user.id)
    .gte("work_date", weekStart)
    .lte("work_date", weekEnd(weekStart));

  if (error) return { ok: false, error: "Could not load that week." };

  const entries: WeekEntry[] = (data ?? []).map((r) => ({
    project_id: String(r.project_id),
    work_date: String(r.work_date).slice(0, 10),
    hours: Number(r.hours) || 0,
    notes: r.notes ?? null,
  }));

  // Only worth asking once something is logged. Fail CLOSED: if the check
  // can't be completed we present the week as locked rather than offering an
  // edit the server would refuse.
  let locked = false;
  if (entries.length > 0) {
    const { data: isLocked, error: lockError } = await supabase.rpc("my_week_locked", {
      week_start: weekStart,
    });
    locked = lockError ? true : Boolean(isLocked);
  }

  return {
    ok: true,
    data: {
      weekStart,
      submitted: entries.length > 0,
      locked,
      editable: weekStart === currentWeekStart() && !locked,
      entries,
    },
  };
}

/**
 * Submit a whole week at once. Only cells with hours > 0 become rows — the
 * `hours > 0` table check means a zero cell is simply the absence of a row.
 */
export async function submitWeek(
  payload: SubmitWeekPayload
): Promise<
  | { ok: true; replaced: boolean; projects: number; total: number }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — please sign in again." };

  const { weekStart } = payload ?? ({} as SubmitWeekPayload);
  const bad = checkWeekStart(weekStart);
  if (bad) return { ok: false, error: bad };

  // Collapse to one value per (project, day) so a malformed payload can't insert
  // the same cell twice — the table has no unique constraint to fall back on.
  const byCell = new Map<string, WeekCell>();
  for (const c of payload.cells ?? []) {
    const projectId = String(c?.projectId ?? "");
    const date = String(c?.date ?? "");
    if (!projectId || !isInWeek(date, weekStart)) continue;
    const hours = normalizeHours(c?.hours);
    if (hours <= 0) continue;
    byCell.set(`${projectId}|${date}`, { projectId, date, hours });
  }

  // An empty payload is only meaningful as a correction — see the `replacing`
  // branch below, where it clears the week back to unsubmitted.
  const cells = [...byCell.values()];

  // A person cannot work more than 24 h in a day across all their projects.
  const perDay = new Map<string, number>();
  for (const c of cells) {
    perDay.set(c.date, sumHours([perDay.get(c.date) ?? 0, c.hours]));
  }
  for (const [date, total] of perDay) {
    if (total > MAX_HOURS_PER_DAY) {
      return { ok: false, error: `${date} adds up to ${total} hours — a day can't exceed 24.` };
    }
  }

  // Is anything already logged for this week? If so this is a correction, not a
  // first submission — allowed only for the week in progress, and only until
  // the hours have been paid.
  const { data: existing, error: existingError } = await supabase
    .from("timesheets")
    .select("id")
    .eq("user_id", user.id)
    .gte("work_date", weekStart)
    .lte("work_date", weekEnd(weekStart));

  if (existingError) return { ok: false, error: "Could not verify that week — please retry." };

  const existingCount = (existing ?? []).length;
  const replacing = existingCount > 0;

  if (!replacing && cells.length === 0) {
    return { ok: false, error: "Enter hours on at least one project before submitting." };
  }

  if (replacing) {
    if (weekStart !== currentWeekStart()) {
      return {
        ok: false,
        error: "That week has closed and can no longer be changed. Ask an admin to correct it.",
      };
    }

    // Fail closed: an unverifiable lock check must not fall through to a delete.
    const { data: isLocked, error: lockError } = await supabase.rpc("my_week_locked", {
      week_start: weekStart,
    });
    if (lockError) return { ok: false, error: "Could not verify that week — please retry." };
    if (isLocked) {
      return {
        ok: false,
        error: "This week has already been paid, so it can no longer be changed.",
      };
    }

    // Replace wholesale. `.select()` reports what actually went — RLS silently
    // skips rows it won't delete, and a short delete would otherwise leave the
    // old rows behind and double-count the week (timesheets has no unique key).
    const { data: deleted, error: deleteError } = await supabase
      .from("timesheets")
      .delete()
      .eq("user_id", user.id)
      .gte("work_date", weekStart)
      .lte("work_date", weekEnd(weekStart))
      .select("id");

    if (deleteError) return { ok: false, error: "Could not update that week — please retry." };
    if ((deleted ?? []).length < existingCount) {
      return {
        ok: false,
        error: "Part of this week could not be changed — it may have just been paid. Reload and try again.",
      };
    }
  }

  const notes = payload.notes ?? {};
  const rows = cells.map((c) => ({
    user_id: user.id,
    project_id: c.projectId,
    work_date: c.date,
    hours: c.hours,
    notes: String(notes[c.projectId] ?? "").trim().slice(0, 500) || null,
  }));

  // Clearing every cell of a submitted week is a valid correction: the delete
  // above already ran, which returns the week to "not submitted".
  if (rows.length > 0) {
    const { error } = await supabase.from("timesheets").insert(rows);
    if (error) {
      return {
        ok: false,
        error: "Could not save. You can only log hours for projects you have access to.",
      };
    }
  }

  // Corrections are worth a trail — hours feed invoices and payroll. Hours and
  // project counts only; no rates, no money.
  if (replacing) {
    await logAudit("revise_timesheet_week", {
      target: weekStart,
      metadata: { rows: rows.length, replaced: existingCount },
    });
  }

  revalidatePath("/");
  return {
    ok: true,
    replaced: replacing,
    projects: new Set(cells.map((c) => c.projectId)).size,
    total: sumHours(cells.map((c) => c.hours)),
  };
}
