// RescueTime bridge. The Analytic Data API tracks time by app/site/window title
// and category — NOT by project — so we pull a day's rows and map window titles
// to portal projects via keyword rules. The API key is a server-only env var.
//
// Docs: https://www.rescuetime.com/rtx/developers  (Analytic Data API)

const BASE = "https://www.rescuetime.com/anapi/data";

export type RtRow = {
  seconds: number;
  activity: string;
  document: string;
  category: string;
  productivity: number;
};

export type RtDay =
  | { ok: true; rows: RtRow[]; totalSeconds: number }
  | { ok: false; error: "no-key" | "http" | "fetch" | "parse"; detail?: string };

// Pull one day's window-title ("document") rows via the API key.
export async function fetchRescueTimeDay(day: string): Promise<RtDay> {
  const key = process.env.RESCUETIME_API_KEY;
  if (!key) return { ok: false, error: "no-key" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, error: "parse", detail: "bad date" };

  const params = new URLSearchParams({
    key,
    format: "json",
    perspective: "rank",
    restrict_kind: "document",
    restrict_begin: day,
    restrict_end: day,
  });

  let json: any;
  try {
    const res = await fetch(`${BASE}?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: "http", detail: String(res.status) };
    json = await res.json();
  } catch (e) {
    return { ok: false, error: "fetch", detail: e instanceof Error ? e.message : "unknown" };
  }

  try {
    const headers: string[] = (json.row_headers || []).map((h: string) => String(h).toLowerCase());
    const col = (needle: string) => headers.findIndex((h) => h.includes(needle));
    const iSec = col("time spent");
    const iAct = col("activity");
    const iDoc = col("document");
    const iCat = col("category");
    const iProd = col("productivity");
    const rows: RtRow[] = (json.rows || []).map((r: any[]) => ({
      seconds: iSec >= 0 ? Number(r[iSec] ?? 0) : 0,
      activity: iAct >= 0 ? String(r[iAct] ?? "") : "",
      document: iDoc >= 0 ? String(r[iDoc] ?? "") : "",
      category: iCat >= 0 ? String(r[iCat] ?? "") : "",
      productivity: iProd >= 0 ? Number(r[iProd] ?? 0) : 0,
    }));
    const totalSeconds = rows.reduce((s, r) => s + r.seconds, 0);
    return { ok: true, rows, totalSeconds };
  } catch {
    return { ok: false, error: "parse" };
  }
}

export type Rule = { keyword: string; project_id: string; project_name: string };

// Attribute each row to the most-specific rule whose keyword appears in its
// window title or activity (case-insensitive). "Most specific" = longest
// keyword, so 'acme-prod' beats 'acme' regardless of how the DB returned the
// rules. Returns matched seconds per project + the unmatched remainder so
// nothing is silently dropped.
export function bucketByRules(rows: RtRow[], rules: Rule[]) {
  // Sort a copy longest-keyword-first so the first match is the most specific.
  const ordered = rules
    .filter((ru) => ru.keyword)
    .sort((a, b) => b.keyword.length - a.keyword.length);
  const perProject = new Map<string, { project_id: string; project_name: string; seconds: number }>();
  let matchedSeconds = 0;
  for (const row of rows) {
    const hay = `${row.document} ${row.activity}`.toLowerCase();
    const rule = ordered.find((ru) => hay.includes(ru.keyword.toLowerCase()));
    if (!rule) continue;
    matchedSeconds += row.seconds;
    const p =
      perProject.get(rule.project_id) ??
      { project_id: rule.project_id, project_name: rule.project_name, seconds: 0 };
    p.seconds += row.seconds;
    perProject.set(rule.project_id, p);
  }
  return {
    perProject: [...perProject.values()].sort((a, b) => b.seconds - a.seconds),
    matchedSeconds,
  };
}

// Seconds → hours, rounded to the nearest quarter hour (how people log time).
export const secToHours = (s: number) => Math.round((s / 3600) * 4) / 4;
export const secToHm = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return `${h}h ${m}m`;
};
