// Shared CSV cell escaper: quote+double any cell containing a comma, quote or
// newline so the value survives a round-trip through a CSV reader.
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  // Neutralize spreadsheet formula injection (leading = + - @ TAB CR), but never
  // mangle a well-formed number — a value like "-42.50" (a negative money cell)
  // is data, not a formula, and must stay numeric so exported totals still sum.
  if (!/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
