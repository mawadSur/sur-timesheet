"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
  /** A week with any logged row is treated as submitted, and renders read-only. */
  submitted: boolean;
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

  return {
    ok: true,
    data: { weekStart, submitted: entries.length > 0, entries },
  };
}

/**
 * Submit a whole week at once. Only cells with hours > 0 become rows — the
 * `hours > 0` table check means a zero cell is simply the absence of a row.
 */
export async function submitWeek(
  payload: SubmitWeekPayload
): Promise<{ ok: true; projects: number; total: number } | { ok: false; error: string }> {
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

  const cells = [...byCell.values()];
  if (cells.length === 0) {
    return { ok: false, error: "Enter hours on at least one project before submitting." };
  }

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

  // Refuse to double-submit: if anything is already logged in this week, the
  // client is out of date (the grid renders submitted weeks read-only).
  const { data: existing, error: existingError } = await supabase
    .from("timesheets")
    .select("id")
    .eq("user_id", user.id)
    .gte("work_date", weekStart)
    .lte("work_date", weekEnd(weekStart))
    .limit(1);

  if (existingError) return { ok: false, error: "Could not verify that week — please retry." };
  if ((existing ?? []).length > 0) {
    return { ok: false, error: "This week has already been submitted." };
  }

  const notes = payload.notes ?? {};
  const rows = cells.map((c) => ({
    user_id: user.id,
    project_id: c.projectId,
    work_date: c.date,
    hours: c.hours,
    notes: String(notes[c.projectId] ?? "").trim().slice(0, 500) || null,
  }));

  const { error } = await supabase.from("timesheets").insert(rows);
  if (error) {
    return {
      ok: false,
      error: "Could not save. You can only log hours for projects you have access to.",
    };
  }

  revalidatePath("/");
  return {
    ok: true,
    projects: new Set(cells.map((c) => c.projectId)).size,
    total: sumHours(cells.map((c) => c.hours)),
  };
}
