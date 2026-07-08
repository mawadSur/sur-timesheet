// Pure date helpers for auto-flagging a project's duration (active vs ended).
// No I/O, no env, no side effects — safe to unit-test. Distinct from the manual
// projects.status field: these are computed purely from the date window.

export type ProjectPhase = "upcoming" | "active" | "ended";

// Reduce an ISO date ("YYYY-MM-DD" or a full timestamp) or a Date to a whole-day
// number (days since the Unix epoch, UTC) so two dates compare by calendar day —
// without time-of-day or timezone drift. Returns null for blank/invalid input.
function dayNumber(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return Math.floor(
      Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) / 86_400_000
    );
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return null;
  return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000);
}

/**
 * True when the project's end date is strictly before today. A project that ends
 * today still counts as active. Missing/invalid dates are treated as not-ended.
 */
export function isEnded(ends_on: string | null, today: Date = new Date()): boolean {
  const end = dayNumber(ends_on);
  const now = dayNumber(today);
  if (end == null || now == null) return false;
  return end < now;
}

/**
 * Lifecycle phase computed from the date window (separate from projects.status):
 * 'ended' once the end date has passed, 'upcoming' before the start date, else
 * 'active'. Missing dates never force upcoming/ended, so an open-ended project
 * with no dates reads as 'active'.
 */
export function projectPhase(
  starts_on: string | null,
  ends_on: string | null,
  today: Date = new Date()
): ProjectPhase {
  const now = dayNumber(today);
  if (now == null) return "active";
  const end = dayNumber(ends_on);
  if (end != null && end < now) return "ended";
  const start = dayNumber(starts_on);
  if (start != null && start > now) return "upcoming";
  return "active";
}
