// Shared CSV cell escaper: quote+double any cell containing a comma, quote or
// newline so the value survives a round-trip through a CSV reader.
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralize spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
