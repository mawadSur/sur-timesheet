// Pure week helpers for the weekly timesheet grid. Weeks run Monday → Sunday.
//
// All arithmetic runs on UTC-midnight epochs so a browser/server timezone gap
// can never shift which week a calendar date lands in. The one place local time
// matters is `todayISO()` — "today" is the user's own calendar day — and it is
// converted to an ISO string immediately, before any week math. No I/O, no env,
// no side effects: safe to unit-test.

export type WeekDay = {
  /** ISO "YYYY-MM-DD" for this column. */
  date: string;
  /** Short weekday name, e.g. "Mon". */
  name: string;
  /** Day of month, e.g. 20. */
  dayOfMonth: number;
  /** Saturday / Sunday — rendered shaded and left at 0 by default. */
  weekend: boolean;
};

const DAY_MS = 86_400_000;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Parse a strict "YYYY-MM-DD" into a UTC-midnight epoch. Returns null for
 * malformed input AND for dates that don't exist (e.g. "2026-02-31"), which
 * Date.UTC would otherwise silently roll forward into March.
 */
function parseISO(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d
  ) {
    return null;
  }
  return t;
}

function fmt(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** True when `iso` is a well-formed, real calendar date. */
export function isValidISODate(iso: string): boolean {
  return parseISO(iso) !== null;
}

/** Shift an ISO date by whole days. Invalid input is returned unchanged. */
export function addDays(iso: string, n: number): string {
  const t = parseISO(iso);
  if (t == null) return iso;
  return fmt(t + n * DAY_MS);
}

/**
 * The Monday of the week containing `iso`. getUTCDay() is 0=Sun…6=Sat, so
 * (dow + 6) % 7 gives days-since-Monday (Mon→0 … Sun→6).
 */
export function mondayOf(iso: string): string {
  const t = parseISO(iso);
  if (t == null) return iso;
  const back = (new Date(t).getUTCDay() + 6) % 7;
  return fmt(t - back * DAY_MS);
}

/** True when `iso` is itself a Monday — the only valid week-start value. */
export function isMonday(iso: string): boolean {
  const t = parseISO(iso);
  return t != null && new Date(t).getUTCDay() === 1;
}

/** Today as the viewer's LOCAL calendar day, in ISO form. */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Monday of the week we're currently in — the latest week that may be submitted. */
export function currentWeekStart(now: Date = new Date()): string {
  return mondayOf(todayISO(now));
}

/** The seven columns of a week, Monday first. */
export function weekDays(weekStart: string): WeekDay[] {
  const start = parseISO(weekStart);
  if (start == null) return [];
  return DAY_NAMES.map((name, i) => {
    const t = start + i * DAY_MS;
    return {
      date: fmt(t),
      name,
      dayOfMonth: new Date(t).getUTCDate(),
      weekend: i >= 5,
    };
  });
}

/** Inclusive last day (Sunday) of the week starting at `weekStart`. */
export function weekEnd(weekStart: string): string {
  return addDays(weekStart, 6);
}

/**
 * Compact human label for a week, collapsing the repeated month/year:
 *   "20 – 26 Jul 2026"   ·   "29 Jun – 5 Jul 2026"   ·   "28 Dec 2026 – 3 Jan 2027"
 */
export function weekRangeLabel(weekStart: string): string {
  const a = parseISO(weekStart);
  if (a == null) return weekStart;
  const b = a + 6 * DAY_MS;
  const [d1, d2] = [new Date(a), new Date(b)];
  const [m1, m2] = [d1.getUTCMonth(), d2.getUTCMonth()];
  const [y1, y2] = [d1.getUTCFullYear(), d2.getUTCFullYear()];
  const left =
    y1 !== y2
      ? `${d1.getUTCDate()} ${MONTHS[m1]} ${y1}`
      : m1 !== m2
        ? `${d1.getUTCDate()} ${MONTHS[m1]}`
        : `${d1.getUTCDate()}`;
  return `${left} – ${d2.getUTCDate()} ${MONTHS[m2]} ${y2}`;
}

/** True when `weekStart` is later than the week containing `now`. */
export function isFutureWeek(weekStart: string, now: Date = new Date()): boolean {
  const w = parseISO(weekStart);
  const c = parseISO(currentWeekStart(now));
  if (w == null || c == null) return false;
  return w > c;
}

/** True when `date` falls inside the week starting at `weekStart`. */
export function isInWeek(date: string, weekStart: string): boolean {
  const d = parseISO(date);
  const s = parseISO(weekStart);
  if (d == null || s == null) return false;
  return d >= s && d <= s + 6 * DAY_MS;
}

/**
 * Round to quarter-hours and clamp to a sane single-day range. Timesheet cells
 * accept 0.25 steps; anything outside 0–24 is out of contract.
 */
export function normalizeHours(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const rounded = Math.round(n * 4) / 4;
  return rounded > 24 ? 24 : rounded;
}

/** Sum that keeps quarter-hour totals free of float drift (0.1+0.2 artefacts). */
export function sumHours(values: number[]): number {
  return values.reduce((acc, n) => Math.round((acc + n) * 100) / 100, 0);
}

/** Trim trailing zeros for display: 8 → "8", 7.5 → "7.5", 7.25 → "7.25". */
export function formatHours(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "0";
  return String(Math.round(n * 100) / 100);
}
