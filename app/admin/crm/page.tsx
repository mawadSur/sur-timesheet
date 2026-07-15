import Link from "next/link";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { summarizePipeline, stageStyle, PIPELINE_STAGES } from "@/lib/crm";
import { usdCents } from "@/lib/books";

type OpportunityRow = {
  id: string;
  name: string;
  status: string | null;
  pipeline_stage: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  pay_type: string | null;
  next_step: string | null;
  next_step_on: string | null;
  estimated_value_cents: number | null;
  manager_name: string | null;
};

const badgeBase: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.6,
};

function statusStyle(status: string | null): React.CSSProperties {
  switch (status) {
    case "Active":
      return { background: "#e6f6ec", color: "#1a7f37", border: "1px solid #b7e3c4" };
    case "On Hold":
      return { background: "#fff5e0", color: "#a15c00", border: "1px solid #f3d8a0" };
    case "Completed":
    case "Closed":
      return { background: "#eef0f2", color: "#5b6470", border: "1px solid #d6dade" };
    case "Prospective":
      return { background: "#e7eefc", color: "#1d4ed8", border: "1px solid #bcd0f7" };
    default:
      return { background: "#eef0f2", color: "#5b6470", border: "1px solid #d6dade" };
  }
}

export default async function CrmPage() {
  const supabase = await createClient();

  // CRM fields live in the admin-only project_crm table; embed the (operational)
  // project fields. Only rows with a pipeline_stage set are tracked candidates.
  const { data } = await supabase
    .from("project_crm")
    .select(
      "pipeline_stage, contact_name, contact_email, contact_phone, next_step, next_step_on, estimated_value_cents, projects!inner(id, name, status, pay_type, manager_name)"
    )
    .not("pipeline_stage", "is", null)
    .order("next_step_on", { ascending: true, nullsFirst: false });

  const opportunities = ((data ?? []) as any[]).map((r) => {
    const p = Array.isArray(r.projects) ? r.projects[0] : r.projects;
    return {
      id: p.id,
      name: p.name,
      status: p.status,
      pay_type: p.pay_type,
      manager_name: p.manager_name,
      pipeline_stage: r.pipeline_stage,
      contact_name: r.contact_name,
      contact_email: r.contact_email,
      contact_phone: r.contact_phone,
      next_step: r.next_step,
      next_step_on: r.next_step_on,
      estimated_value_cents: r.estimated_value_cents,
    };
  }) as OpportunityRow[];
  const summary = summarizePipeline(opportunities);
  const todayIso = new Date().toISOString().slice(0, 10);

  const tile: React.CSSProperties = {
    border: "1px solid #e3e7ec",
    borderRadius: 12,
    padding: 16,
    background: "#fff",
  };
  const tileLabel: React.CSSProperties = {
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "#5b6470",
    fontWeight: 600,
  };
  const tileValue: React.CSSProperties = {
    fontSize: 24,
    fontWeight: 700,
    marginTop: 6,
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">{BRAND.name.charAt(0)}</div>
          <div className="wordmark">
            {BRAND.name}
            <small>CRM</small>
          </div>
          <nav className="topnav">
            <Link className="navlink" href="/admin">
              Admin
            </Link>
            <Link className="navlink" href="/admin/dashboard">
              Dashboard
            </Link>
            <Link className="navlink" href="/admin/books">
              Books
            </Link>
            <Link className="navlink" href="/">
              Timesheet
            </Link>
            <form action={signOut}>
              <button type="submit" className="navlink navbtn">
                Log out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="page admin">
        <section className="card">
          <h2 className="card-title">Pipeline</h2>
          <p className="intro">
            Incoming contractors tracked on top of the existing project records. Use the project
            detail page to update contact, employment type, next step, rate, and stage.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
              marginTop: 8,
            }}
          >
            <div style={tile}>
              <div style={tileLabel}>In pipeline</div>
              <div style={tileValue}>{summary.count}</div>
            </div>
            <div style={tile}>
              <div style={tileLabel}>Expected starts</div>
              <div style={tileValue}>{summary.weightedStarts.toFixed(1)}</div>
            </div>
            <div style={tile}>
              <div style={tileLabel}>Avg rate</div>
              <div style={tileValue}>
                {summary.avgRateCents > 0 ? `${usdCents(summary.avgRateCents)}/hr` : "—"}
              </div>
            </div>
          </div>

          <p className="muted-cell" style={{ fontSize: 13, marginTop: 10 }}>
            {PIPELINE_STAGES.map((stage) => `${stage}: ${summary.byStage[stage]}`).join(" · ")}
          </p>
        </section>

        <section className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <h2 className="card-title" style={{ margin: 0 }}>
              Candidates
            </h2>
            <Link className="btn-sm" href="/admin">
              Add candidate
            </Link>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Project</th>
                <th>Stage</th>
                <th>Type</th>
                <th className="right">Rate</th>
                <th>Contact</th>
                <th>Next step</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.map((opp) => {
                const overdue = !!opp.next_step_on && opp.next_step_on < todayIso;
                return (
                  <tr key={opp.id}>
                    <td>
                      <Link href={`/admin/projects/${opp.id}`}>{opp.name}</Link>
                      {opp.manager_name && (
                        <div className="muted-cell" style={{ fontSize: 12 }}>
                          Manager: {opp.manager_name}
                        </div>
                      )}
                    </td>
                    <td>
                      <span style={{ ...badgeBase, ...stageStyle(opp.pipeline_stage) }}>
                        {opp.pipeline_stage || "—"}
                      </span>
                    </td>
                    <td>{opp.pay_type || <span className="muted-cell">—</span>}</td>
                    <td className="right">
                      {opp.estimated_value_cents != null
                        ? `${usdCents(Number(opp.estimated_value_cents))}/hr`
                        : "—"}
                    </td>
                    <td>
                      {opp.contact_name || opp.contact_email || opp.contact_phone ? (
                        <>
                          <div>{opp.contact_name || "—"}</div>
                          {opp.contact_email && (
                            <div className="muted-cell" style={{ fontSize: 12 }}>
                              {opp.contact_email}
                            </div>
                          )}
                          {opp.contact_phone && (
                            <div className="muted-cell" style={{ fontSize: 12 }}>
                              {opp.contact_phone}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="muted-cell">—</span>
                      )}
                    </td>
                    <td>
                      {opp.next_step ? (
                        <>
                          <div>{opp.next_step}</div>
                          {opp.next_step_on && (
                            <div
                              className="muted-cell"
                              style={{ fontSize: 12, color: overdue ? "var(--red)" : undefined }}
                            >
                              due {opp.next_step_on}
                              {overdue ? " — overdue" : ""}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="muted-cell">—</span>
                      )}
                    </td>
                    <td>
                      <span style={{ ...badgeBase, ...statusStyle(opp.status) }}>{opp.status || "—"}</span>
                    </td>
                  </tr>
                );
              })}
              {opportunities.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted-cell">
                    No candidates yet. Add one from the Admin page by setting a pipeline stage on a project.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
