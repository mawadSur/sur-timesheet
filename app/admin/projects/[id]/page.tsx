import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  updateProject,
  addTimeOff,
  deleteTimeOff,
  refreshDiscordStatus,
} from "@/app/project-actions";
import {
  addFeedback,
  deleteFeedback,
  getProjectFeedback,
} from "@/app/feedback-actions";
import { addExpense, deleteExpense, getProjectExpenses } from "@/app/expense-actions";
import { updateOpportunity } from "@/app/crm-actions";
import { PIPELINE_STAGES, stageStyle } from "@/lib/crm";
import { usdCents } from "@/lib/books";
import AdminCredentials from "@/components/AdminCredentials";

const STATUSES = ["Prospective", "Active", "On Hold", "Completed", "Closed"];

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

const badgeBase: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 10px",
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.6,
};

export default async function ProjectDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: assignments }, { data: timeOff }, { data: crmRow }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("assignments").select("id, profiles(id, full_name, email)").eq("project_id", id),
    supabase.from("time_off").select("*").eq("project_id", id).order("start_date"),
    // Candidate CRM fields live in the admin-only project_crm table (may be absent).
    supabase.from("project_crm").select("*").eq("project_id", id).maybeSingle(),
  ]);

  if (!project) {
    return (
      <main className="page admin">
        <Breadcrumbs items={[{ label: "Projects", href: "/admin/dashboard" }, { label: "Not found" }]} />
        <section className="card">
          <h2 className="card-title">Project not found</h2>
          <p className="intro">This project doesn&apos;t exist or has been removed.</p>
          <Link className="btn" href="/admin/dashboard">
            Back to dashboard
          </Link>
        </section>
      </main>
    );
  }

  const people = (assignments ?? []) as any[];
  const days = (timeOff ?? []) as any[];
  const crm = (crmRow ?? {}) as any;
  const todayIso = new Date().toISOString().slice(0, 10);
  const personName = (n: { full_name: string | null; email: string } | null) =>
    n?.full_name || n?.email || "—";

  // Continuous feedback. The feedback table may not exist until its migration is
  // applied, so tolerate a read failure and fall back to an empty list rather than
  // crashing the whole project page.
  let feedback: any[] = [];
  try {
    feedback = ((await getProjectFeedback(id)) ?? []) as any[];
  } catch {
    feedback = [];
  }

  // Expense ledger — same tolerance: the expenses table may not exist until its
  // migration is applied, so fall back to an empty list rather than crashing.
  let expenses: any[] = [];
  try {
    expenses = ((await getProjectExpenses(id)) ?? []) as any[];
  } catch {
    expenses = [];
  }
  const expensesTotal = expenses.reduce((s, e) => s + (Number(e.amount_cents) || 0), 0);

  return (
    <main className="page admin">
      <Breadcrumbs
        items={[{ label: "Projects", href: "/admin/dashboard" }, { label: project.name }]}
      />
      {/* ── Header ────────────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">{project.name}</h2>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
            <span style={{ ...badgeBase, ...statusStyle(project.status) }}>{project.status || "—"}</span>
            <span
              style={{
                ...badgeBase,
                background: "#f4f5f7",
                color: "#444c56",
                border: "1px solid #e3e7ec",
              }}
            >
              {project.pay_type || "— pay"}
            </span>
            <span className="muted-cell" style={{ fontSize: 13 }}>
              {project.starts_on || "—"} → {project.ends_on || "—"}
            </span>
          </div>
          {project.description && <p className="intro" style={{ marginTop: 10 }}>{project.description}</p>}
        </section>

        {/* ── Pipeline / CRM ────────────────────────────────────────── */}
        <section className="card">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <h2 className="card-title" style={{ margin: 0 }}>Pipeline / CRM</h2>
            {crm.pipeline_stage && (
              <span style={{ ...badgeBase, ...stageStyle(crm.pipeline_stage) }}>{crm.pipeline_stage}</span>
            )}
            {crm.estimated_value_cents != null && (
              <span className="count-pill">{usdCents(Number(crm.estimated_value_cents))}/hr</span>
            )}
            {project.pay_type && <span className="count-pill">{project.pay_type}</span>}
          </div>
          <p className="intro">
            Track this as an incoming contractor. Stage, contact, employment type, next step and
            hourly rate &mdash; a useful minimum. Leave the stage blank if it isn&apos;t a tracked candidate.
          </p>
          {crm.next_step && (
            <p style={{ margin: "4px 0 8px" }}>
              <strong>Next step:</strong> {crm.next_step}
              {crm.next_step_on && (
                <span
                  className="muted-cell"
                  style={{ marginLeft: 8, color: crm.next_step_on < todayIso ? "var(--red)" : undefined }}
                >
                  (due {crm.next_step_on}{crm.next_step_on < todayIso ? " — overdue" : ""})
                </span>
              )}
            </p>
          )}

          <form action={updateOpportunity} className="stack-form">
            <input type="hidden" name="id" value={project.id} />
            <div className="field-row">
              <div className="field">
                <label>Pipeline stage</label>
                <select name="pipeline_stage" defaultValue={crm.pipeline_stage || ""}>
                  <option value="">— Not a candidate —</option>
                  {PIPELINE_STAGES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Rate ($/hr)</label>
                <input
                  name="estimated_value"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={crm.estimated_value_cents != null ? Number(crm.estimated_value_cents) / 100 : ""}
                  placeholder="e.g. 85"
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Contact name</label>
                <input name="contact_name" defaultValue={crm.contact_name || ""} placeholder="Point of contact" />
              </div>
              <div className="field">
                <label>Contact email</label>
                <input name="contact_email" type="email" defaultValue={crm.contact_email || ""} placeholder="name@company.com" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Contact phone</label>
                <input name="contact_phone" type="tel" defaultValue={crm.contact_phone || ""} placeholder="+1 555 000 0000" />
              </div>
              <div className="field">
                <label>Employment type</label>
                <select name="pay_type" defaultValue={project.pay_type || ""}>
                  <option value="">—</option>
                  <option value="W2">W2</option>
                  <option value="1099">1099</option>
                  <option value="C2C">C2C</option>
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Next step due</label>
                <input name="next_step_on" type="date" defaultValue={crm.next_step_on || ""} />
              </div>
            </div>
            <div className="field">
              <label>Next step</label>
              <input name="next_step" defaultValue={crm.next_step || ""} placeholder="e.g. Send offer letter, schedule background check" />
            </div>
            <button type="submit" className="btn">Save candidate</button>
          </form>
        </section>

        {/* ── Discord status ────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">Discord status</h2>
          <p style={{ whiteSpace: "pre-wrap", margin: "8px 0" }}>
            {project.discord_status_summary || "No status pulled yet."}
          </p>
          {project.discord_status_updated_at && (
            <p className="muted-cell" style={{ fontSize: 12 }}>
              Updated {new Date(project.discord_status_updated_at).toLocaleString()}
            </p>
          )}
          <form action={refreshDiscordStatus} style={{ marginTop: 8 }}>
            <input type="hidden" name="id" value={project.id} />
            <button type="submit" className="btn">
              Refresh status
            </button>
          </form>
          <p className="muted-cell" style={{ fontSize: 12, marginTop: 8 }}>
            Pulls the latest channel messages and summarizes them (needs Discord + Anthropic keys configured).
          </p>
        </section>

        {/* ── Who's working on it ───────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">Who&apos;s working on it</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Person</th>
              </tr>
            </thead>
            <tbody>
              {people.map((a) => (
                <tr key={a.id}>
                  <td>{personName(a.profiles)}</td>
                </tr>
              ))}
              {people.length === 0 && (
                <tr>
                  <td className="muted-cell">No one assigned yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ── Days off ──────────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">Days off</h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Person</th>
                <th>Dates</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.id}>
                  <td>{d.person_name || "—"}</td>
                  <td className="muted-cell">
                    {d.start_date} → {d.end_date || d.start_date}
                  </td>
                  <td className="muted-cell">{d.note || "—"}</td>
                  <td className="right">
                    <form action={deleteTimeOff}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="project_id" value={project.id} />
                      <button type="submit" className="link-btn">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {days.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted-cell">
                    No days off recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <form action={addTimeOff} className="stack-form" style={{ marginTop: 12 }}>
            <input type="hidden" name="project_id" value={project.id} />
            <div className="field-row">
              <div className="field">
                <label>Person</label>
                <input name="person_name" placeholder="Name" />
              </div>
              <div className="field">
                <label>Start date</label>
                <input name="start_date" type="date" required />
              </div>
              <div className="field">
                <label>End date</label>
                <input name="end_date" type="date" />
              </div>
            </div>
            <div className="field">
              <label>Note</label>
              <input name="note" placeholder="Optional" />
            </div>
            <button type="submit" className="btn">
              Add days off
            </button>
          </form>
        </section>

        {/* ── Expenses ──────────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">
            Expenses{" "}
            <span className="count-pill">{usdCents(expensesTotal)} total</span>
          </h2>
          <p className="intro">
            Project costs &mdash; hardware, licenses, travel, subcontractors. These roll into
            the <Link href="/admin/books">Books</Link> net for the month they were spent. Admin-only.
          </p>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Vendor</th>
                <th className="right">Amount</th>
                <th>Description</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td>{e.spent_on}</td>
                  <td>{e.category || "—"}</td>
                  <td className="muted-cell">{e.vendor || "—"}</td>
                  <td className="right">{usdCents(Number(e.amount_cents) || 0)}</td>
                  <td className="muted-cell">{e.description || "—"}</td>
                  <td className="right">
                    <form action={deleteExpense}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="project_id" value={project.id} />
                      <button type="submit" className="link-btn">Remove</button>
                    </form>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted-cell">No expenses recorded.</td>
                </tr>
              )}
            </tbody>
          </table>

          <form action={addExpense} className="stack-form" style={{ marginTop: 12 }}>
            <input type="hidden" name="project_id" value={project.id} />
            <div className="field-row">
              <div className="field">
                <label>Date</label>
                <input name="spent_on" type="date" defaultValue={todayIso} required />
              </div>
              <div className="field">
                <label>Amount ($)</label>
                <input name="amount" type="number" step="0.01" min="0" placeholder="e.g. 149.99" required />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Category</label>
                <input name="category" placeholder="Hardware, License, Travel, …" />
              </div>
              <div className="field">
                <label>Vendor</label>
                <input name="vendor" placeholder="Optional" />
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <input name="description" placeholder="Optional" />
            </div>
            <button type="submit" className="btn">Add expense</button>
          </form>
        </section>

        {/* ── Feedback ──────────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">Feedback</h2>
          <p className="intro">
            Continuous notes on how the project&mdash;and the people on it&mdash;are doing.
          </p>
          <table className="tbl">
            <thead>
              <tr>
                <th>From</th>
                <th>About</th>
                <th>Note</th>
                <th>When</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {feedback.map((f) => (
                <tr key={f.id}>
                  <td>{f.author_name || "—"}</td>
                  <td>{f.subject_name || "—"}</td>
                  <td>{f.body}</td>
                  <td className="muted-cell">
                    {f.created_at ? new Date(f.created_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="right">
                    <form action={deleteFeedback.bind(null, f.id)}>
                      <button type="submit" className="link-btn">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {feedback.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted-cell">
                    No feedback yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <form action={addFeedback} className="stack-form" style={{ marginTop: 12 }}>
            <input type="hidden" name="project_id" value={project.id} />
            <div className="field-row">
              <div className="field">
                <label>About (optional)</label>
                <select name="subject_profile_id" defaultValue="">
                  <option value="">— Whole project —</option>
                  {people.map(
                    (a) =>
                      a.profiles?.id && (
                        <option key={a.id} value={a.profiles.id}>
                          {personName(a.profiles)}
                        </option>
                      )
                  )}
                </select>
              </div>
            </div>
            <div className="field">
              <label>Note</label>
              <input name="body" placeholder="What's going well or needs attention" required />
            </div>
            <button type="submit" className="btn">
              Add feedback
            </button>
          </form>
        </section>

        {/* ── Details / edit ────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">Details</h2>
          <p className="intro">
            Manager: {project.manager_name || "—"} · IT support: {project.it_support_phone || "—"} · Recruiter:{" "}
            {project.recruiter_email || "—"} · Tailscale: {project.tailscale_tag || "—"}
          </p>

          <form action={updateProject} className="stack-form">
            <input type="hidden" name="id" value={project.id} />
            <div className="field-row">
              <div className="field">
                <label>Status</label>
                <select name="status" defaultValue={project.status || "Active"}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Manager name</label>
                <input name="manager_name" defaultValue={project.manager_name || ""} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>IT support phone</label>
                <input name="it_support_phone" defaultValue={project.it_support_phone || ""} />
              </div>
              <div className="field">
                <label>Recruiter email</label>
                <input name="recruiter_email" type="email" defaultValue={project.recruiter_email || ""} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Discord channel ID</label>
                <input name="discord_channel_id" defaultValue={project.discord_channel_id || ""} />
              </div>
              <div className="field">
                <label>Tailscale tag</label>
                <input
                  name="tailscale_tag"
                  defaultValue={project.tailscale_tag || ""}
                  placeholder="tag:acme"
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Start date</label>
                <input name="starts_on" type="date" defaultValue={project.starts_on || ""} />
              </div>
              <div className="field">
                <label>End date</label>
                <input name="ends_on" type="date" defaultValue={project.ends_on || ""} />
              </div>
            </div>
            <button type="submit" className="btn">
              Save details
            </button>
          </form>
        </section>

        {/* ── Credentials ───────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">Credentials</h2>
          <AdminCredentials projectId={id} projectName={project.name} />
        </section>
    </main>
  );
}
