import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { addRescueTimeRule, deleteRescueTimeRule, logRescueTimeHours } from "@/app/rescuetime-actions";
import { fetchRescueTimeDay, bucketByRules, secToHours, secToHm, type Rule } from "@/lib/rescuetime";

export default async function RescueTime({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; logged?: string; skipped?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();

  const loggedCount = sp.logged ? Number(sp.logged) : 0;
  const skippedDesc = typeof sp.skipped === "string" ? sp.skipped : "";

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const day = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : today;
  const shift = (d: string, delta: number) => {
    const t = new Date(d + "T00:00:00");
    t.setDate(t.getDate() + delta);
    return t.toISOString().slice(0, 10);
  };

  const [rt, { data: ruleRows }, { data: projects }] = await Promise.all([
    fetchRescueTimeDay(day),
    supabase.from("rescuetime_rules").select("id, keyword, project_id, projects(name)").order("keyword"),
    supabase.from("projects").select("id, name").order("name"),
  ]);

  const rules: Rule[] = (ruleRows ?? []).map((r: any) => ({
    keyword: r.keyword,
    project_id: r.project_id,
    project_name: r.projects?.name ?? "—",
  }));

  const bucket = rt.ok ? bucketByRules(rt.rows, rules) : { perProject: [], matchedSeconds: 0 };
  const topRows = rt.ok ? [...rt.rows].sort((a, b) => b.seconds - a.seconds).slice(0, 12) : [];
  const unmatched = rt.ok ? rt.totalSeconds - bucket.matchedSeconds : 0;

  const tile: React.CSSProperties = { border: "1px solid #e3e7ec", borderRadius: 12, padding: 16, background: "#fff" };
  const tileLabel: React.CSSProperties = { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, color: "#5b6470", fontWeight: 600 };
  const tileValue: React.CSSProperties = { fontSize: 22, fontWeight: 700, marginTop: 6 };

  return (
    <>
      <main className="page admin">
        {/* ── Log result notice (post-redirect) ─────────────────────── */}
        {(loggedCount > 0 || skippedDesc) && (
          <section className="card" style={{ borderLeft: `4px solid ${skippedDesc ? "#f79009" : "#12b76a"}` }}>
            {loggedCount > 0 && (
              <p className="intro" style={{ margin: skippedDesc ? "0 0 6px" : 0 }}>
                ✅ Logged {loggedCount} {loggedCount === 1 ? "entry" : "entries"} to your timesheet for {day}.
              </p>
            )}
            {skippedDesc && (
              <p className="intro" style={{ margin: 0 }}>
                ⚠️ Already logged for {skippedDesc} on {day} — skipped to avoid double-counting.
                Adjust on your timesheet if the hours changed.
              </p>
            )}
          </section>
        )}

        {/* ── Not configured ───────────────────────────────────────── */}
        {!rt.ok && rt.error === "no-key" && (
          <section className="card">
            <h2 className="card-title">Connect RescueTime</h2>
            <p className="intro">
              This pulls your own RescueTime tracked time so you can turn it into project hours.
              To connect:
            </p>
            <ol style={{ lineHeight: 1.8, paddingLeft: 20 }}>
              <li>Get your API key at <strong>rescuetime.com/anapi/manage</strong>.</li>
              <li>Set <code>RESCUETIME_API_KEY</code> on Vercel (all environments) and in <code>.env.local</code>.</li>
              <li>Redeploy / restart, then reload this page.</li>
            </ol>
            <p className="muted-cell" style={{ fontSize: 13 }}>
              The key is server-only and never sent to the browser. RescueTime tracks time by
              app / website / window title, not by project — the keyword rules below map those to
              your projects.
            </p>
          </section>
        )}

        {!rt.ok && rt.error !== "no-key" && (
          <section className="card" style={{ borderLeft: "4px solid #f79009" }}>
            <p className="intro" style={{ margin: 0 }}>
              ⚠️ Couldn&apos;t reach RescueTime ({rt.error}{rt.detail ? `: ${rt.detail}` : ""}). Check the API key and try again.
            </p>
          </section>
        )}

        {/* ── Day view ─────────────────────────────────────────────── */}
        <section className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <h2 className="card-title" style={{ margin: 0 }}>Tracked time &mdash; {day}</h2>
            <div style={{ display: "flex", gap: 8, marginLeft: "auto", alignItems: "center" }}>
              <Link className="btn-sm" href={`/admin/rescuetime?day=${shift(day, -1)}`}>← Prev</Link>
              <form method="get" style={{ display: "flex", gap: 6 }}>
                <input type="date" name="day" defaultValue={day} max={today} />
                <button type="submit" className="btn-sm">View</button>
              </form>
              <Link className="btn-sm" href={`/admin/rescuetime?day=${shift(day, 1)}`}>Next →</Link>
            </div>
          </div>

          {rt.ok && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 12 }}>
              <div style={tile}><div style={tileLabel}>Total tracked</div><div style={tileValue}>{secToHm(rt.totalSeconds)}</div></div>
              <div style={tile}><div style={tileLabel}>Matched to projects</div><div style={tileValue}>{secToHm(bucket.matchedSeconds)}</div></div>
              <div style={tile}><div style={tileLabel}>Unmatched</div><div style={tileValue}>{secToHm(unmatched)}</div></div>
            </div>
          )}
        </section>

        {/* ── Suggested project hours ──────────────────────────────── */}
        {rt.ok && bucket.perProject.length > 0 && (
          <section className="card">
            <h2 className="card-title">Suggested project hours</h2>
            <p className="intro">From your keyword rules. Review, then log them to your timesheet for {day}.</p>
            <form action={logRescueTimeHours}>
              <input type="hidden" name="date" value={day} />
              <table className="tbl">
                <thead><tr><th>Project</th><th className="right">Tracked</th><th className="right">Suggested hours</th></tr></thead>
                <tbody>
                  {bucket.perProject.map((p) => {
                    const hrs = secToHours(p.seconds);
                    return (
                      <tr key={p.project_id}>
                        <td>{p.project_name}</td>
                        <td className="right muted-cell">{secToHm(p.seconds)}</td>
                        <td className="right">{hrs} h</td>
                        {hrs > 0 && <input type="hidden" name="entry" value={`${p.project_id}:${hrs}`} />}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button type="submit" className="btn" style={{ marginTop: 12 }}>Log these to my timesheet</button>
              <p className="muted-cell" style={{ fontSize: 12, marginTop: 8 }}>
                Only projects you&apos;re assigned to will save (row-level security). Adjust anytime on the timesheet.
              </p>
            </form>
          </section>
        )}

        {/* ── Keyword rules ────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">Keyword → project rules</h2>
          <p className="intro">
            When a window title or activity contains a keyword, its time is attributed to that project.
            First matching rule wins (most specific first).
          </p>
          <form action={addRescueTimeRule} className="inline-form">
            <input name="keyword" placeholder="e.g. hertz, acme-repo, figma" required />
            <select name="project_id" required defaultValue="">
              <option value="" disabled>Select project…</option>
              {(projects ?? []).map((p: any) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
            <button type="submit" className="btn">Add rule</button>
          </form>
          <table className="tbl">
            <thead><tr><th>Keyword</th><th>Project</th><th></th></tr></thead>
            <tbody>
              {(ruleRows ?? []).map((r: any) => (
                <tr key={r.id}>
                  <td>{r.keyword}</td>
                  <td>{r.projects?.name ?? "—"}</td>
                  <td className="right">
                    <form action={deleteRescueTimeRule}>
                      <input type="hidden" name="id" value={r.id} />
                      <button type="submit" className="link-btn">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
              {(ruleRows ?? []).length === 0 && (<tr><td colSpan={3} className="muted-cell">No rules yet.</td></tr>)}
            </tbody>
          </table>
        </section>

        {/* ── Raw activity (helps you write rules) ─────────────────── */}
        {rt.ok && topRows.length > 0 && (
          <section className="card">
            <h2 className="card-title">Top activity this day</h2>
            <p className="intro">Use these window titles / activities to decide what keywords to add.</p>
            <table className="tbl">
              <thead><tr><th>Window title / document</th><th>Activity</th><th className="right">Time</th></tr></thead>
              <tbody>
                {topRows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.document || "—"}</td>
                    <td className="muted-cell">{r.activity || "—"}</td>
                    <td className="right">{secToHm(r.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </main>
    </>
  );
}
