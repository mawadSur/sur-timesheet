import Link from "next/link";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import {
  updateProject,
  addTimeOff,
  deleteTimeOff,
  refreshDiscordStatus,
} from "@/app/project-actions";
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

function Topbar() {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="logo">{BRAND.name.charAt(0)}</div>
        <div className="wordmark">
          {BRAND.name}
          <small>Project</small>
        </div>
        <nav className="topnav">
          <Link className="navlink" href="/admin/dashboard">
            Dashboard
          </Link>
          <Link className="navlink" href="/admin">
            Admin
          </Link>
          <form action={signOut}>
            <button type="submit" className="navlink navbtn">
              Log out
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}

export default async function ProjectDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: assignments }, { data: timeOff }] = await Promise.all([
    supabase.from("projects").select("*").eq("id", id).single(),
    supabase.from("assignments").select("id, profiles(full_name, email)").eq("project_id", id),
    supabase.from("time_off").select("*").eq("project_id", id).order("start_date"),
  ]);

  if (!project) {
    return (
      <>
        <Topbar />
        <main className="page admin">
          <section className="card">
            <h2 className="card-title">Project not found</h2>
            <p className="intro">This project doesn&apos;t exist or has been removed.</p>
            <Link className="btn" href="/admin/dashboard">
              Back to dashboard
            </Link>
          </section>
        </main>
      </>
    );
  }

  const people = (assignments ?? []) as any[];
  const days = (timeOff ?? []) as any[];
  const personName = (n: { full_name: string | null; email: string } | null) =>
    n?.full_name || n?.email || "—";

  return (
    <>
      <Topbar />
      <main className="page admin">
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

        {/* ── Details / edit ────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">Details</h2>
          <p className="intro">
            Manager: {project.manager_name || "—"} · IT support: {project.it_support_phone || "—"} · Recruiter:{" "}
            {project.recruiter_email || "—"}
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
                <label>Pay type</label>
                <select name="pay_type" defaultValue={project.pay_type || ""}>
                  <option value="">—</option>
                  <option value="C2C">C2C</option>
                  <option value="W2">W2</option>
                  <option value="1099">1099</option>
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Manager name</label>
                <input name="manager_name" defaultValue={project.manager_name || ""} />
              </div>
              <div className="field">
                <label>IT support phone</label>
                <input name="it_support_phone" defaultValue={project.it_support_phone || ""} />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Recruiter email</label>
                <input name="recruiter_email" type="email" defaultValue={project.recruiter_email || ""} />
              </div>
              <div className="field">
                <label>Discord channel ID</label>
                <input name="discord_channel_id" defaultValue={project.discord_channel_id || ""} />
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
    </>
  );
}
