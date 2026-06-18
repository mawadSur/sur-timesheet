import { NextResponse } from "next/server";
import { EMPLOYEES, projectsForEmployee } from "@/config/timesheet";

export const runtime = "nodejs";

type IncomingEntry = { project?: unknown; hours?: unknown; notes?: unknown };

export async function POST(req: Request) {
  let body: {
    employee?: unknown;
    date?: unknown;
    entries?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid request." },
      { status: 400 }
    );
  }

  const employee = typeof body.employee === "string" ? body.employee.trim() : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const rawEntries = Array.isArray(body.entries) ? body.entries : [];

  // ── Validate employee against the configured team ──────────────────────────
  if (!employee || !EMPLOYEES.some((e) => e.name === employee)) {
    return NextResponse.json(
      { ok: false, error: "Unknown employee." },
      { status: 400 }
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { ok: false, error: "Invalid date." },
      { status: 400 }
    );
  }

  const allowed = new Set(projectsForEmployee(employee));

  const entries = (rawEntries as IncomingEntry[])
    .map((e) => ({
      project: typeof e.project === "string" ? e.project.trim() : "",
      hours: Number(e.hours),
      notes: typeof e.notes === "string" ? e.notes.trim().slice(0, 500) : "",
    }))
    .filter(
      (e) =>
        e.project &&
        allowed.has(e.project) &&
        Number.isFinite(e.hours) &&
        e.hours > 0 &&
        e.hours <= 24
    );

  if (entries.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No valid project hours to save." },
      { status: 400 }
    );
  }

  // ── Forward to the Google Sheet (Apps Script web app) ───────────────────────
  const webhook = process.env.SHEETS_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Timesheet isn't connected to a Google Sheet yet. The admin needs to set SHEETS_WEBHOOK_URL (see README).",
      },
      { status: 503 }
    );
  }

  const payload = {
    secret: process.env.SHEETS_SHARED_SECRET || "",
    submittedAt: new Date().toISOString(),
    employee,
    date,
    entries,
  };

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      // Apps Script can be slow on a cold start.
      signal: AbortSignal.timeout(15000),
    });

    const text = await res.text();
    let data: { ok?: boolean; error?: string } = {};
    try {
      data = JSON.parse(text);
    } catch {
      // Apps Script sometimes returns an HTML error page on misconfiguration.
      throw new Error("Unexpected response from Google Sheet.");
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Google Sheet rejected the entry.");
    }

    return NextResponse.json({ ok: true, rows: entries.length });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Could not reach the Google Sheet.";
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
