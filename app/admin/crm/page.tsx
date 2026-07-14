import Link from "next/link";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { summarizePipeline, stageStyle } from "@/lib/crm";
import { usdCents } from "@/lib/books";

type OpportunityRow = {
  id: string;
  name: string;
  status: string | null;
  pipeline_stage: string | null;
  contact_name: string | null;
  contact_email: string | null;
  source: string | null;
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

  const { data } = await supabase
    .from("projects")
    .select(
      "id, name, status, pipeline_stage, contact_name, contact_email, source, next_step, next_step_on, estimated_value_cents, manager_name"
    )
    .not("pipeline_stage", "is", null)
    .order("next_step_on", { ascending: true, nullsFirst: false })
    .order("name");

  const opportunities = (data ?? []) as OpportunityRow[];
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
            Incoming work tracked on top of the existing project records. Use the project detail page to
            update contact, source, next step, value, and stage.
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
              <div style={tileLabel}>Open pipeline</div>
              <div style={tileValue}>{usdCents(summary.open)}</div>
            </div>
            <div style={tile}>
              <div style={tileLabel}>Weighted forecast</div>
              <div style={tileValue}>{usdCents(summary.weighted)}</div>
            </div>
            <div style={tile}>
              <div style={tileLabel}>Open deals</div>
              <div style={tileValue}>{summary.openCount}</div>
            </div>
            <div style={tile}>
              <div style={tileLabel}>Won</div>
              <div style={tileValue}>{usdCents(summary.won)}</div>
            </div>
            <div style={tile}>
              <div style={tileLabel}>Lost</div>
              <div style={{ ...tileValue, color: summary.lost > 0 ? "var(--red)" : undefined }}>
                {usdCents(summary.lost)}
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <h2 className="card-title" style={{ margin: 0 }}>
              Opportunities
            </h2>
            <Link className="btn-sm" href="/admin">
              Add opportunity
            </Link>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Project</th>
                <th>Stage</th>
                <th className="right">Value</th>
                <th>Contact</th>
                <th>Source</th>
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
                    <td className="right">
                      {opp.estimated_value_cents != null ? usdCents(Number(opp.estimated_value_cents)) : "—"}
                    </td>
                    <td>
                      {opp.contact_name || opp.contact_email ? (
                        <>
                          <div>{opp.contact_name || "—"}</div>
                          {opp.contact_email && (
                            <div className="muted-cell" style={{ fontSize: 12 }}>
                              {opp.contact_email}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="muted-cell">—</span>
                      )}
                    </td>
                    <td>{opp.source || <span className="muted-cell">—</span>}</td>
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
                    No opportunities yet. Add one from the Admin page by setting a pipeline stage on a project.
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
