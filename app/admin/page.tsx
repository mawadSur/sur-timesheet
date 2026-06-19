import Link from "next/link";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import {
  addAllowedEmail,
  removeAllowedEmail,
  setRole,
  createProject,
  deleteProject,
  assignProject,
  unassignProject,
  signOut,
} from "@/app/actions";
import AdminCredentials from "@/components/AdminCredentials";
import UserAccessControls from "@/components/UserAccessControls";

type Named = { full_name: string | null; email: string } | null;

export default async function Admin() {
  const supabase = await createClient();

  const [{ data: allowed }, { data: profiles }, { data: projects }, { data: assignments }, { data: timesheets }] =
    await Promise.all([
      supabase.from("allowed_emails").select("email, role, is_active").order("email"),
      supabase.from("profiles").select("id, full_name, email, role").order("email"),
      supabase.from("projects").select("id, name, starts_on, ends_on, vm_host").order("name"),
      supabase
        .from("assignments")
        .select("id, profiles(full_name, email), projects(name)")
        .order("assigned_at", { ascending: false }),
      supabase
        .from("timesheets")
        .select("work_date, hours, notes, profiles(full_name, email), projects(name)")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  const registered = new Set((profiles ?? []).map((p) => p.email.toLowerCase()));
  const totalHours = (timesheets ?? []).reduce((s, t) => s + Number(t.hours), 0);
  const name = (n: Named) => n?.full_name || n?.email || "—";

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">{BRAND.name.charAt(0)}</div>
          <div className="wordmark">
            {BRAND.name}
            <small>Admin</small>
          </div>
          <nav className="topnav">
            <Link className="navlink" href="/">
              Timesheet
            </Link>
            <Link className="navlink" href="/admin/audit">
              Audit
            </Link>
            <a className="navlink" href="/admin/export">
              Export CSV
            </a>
            <form action={signOut}>
              <button type="submit" className="navlink navbtn">
                Log out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="page admin">
        {/* ── People & access ─────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">People &amp; access</h2>
          <p className="intro">
            Only emails on this list can sign in with Google. Add someone before
            they try to log in.
          </p>

          <form action={addAllowedEmail} className="inline-form">
            <input name="email" type="email" placeholder="person@email.com" required />
            <select name="role" defaultValue="employee">
              <option value="employee">Employee</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit" className="btn">
              Add
            </button>
          </form>

          <table className="tbl">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(allowed ?? []).map((a) => (
                <tr key={a.email}>
                  <td>{a.email}</td>
                  <td>
                    <form action={setRole} className="row-form">
                      <input type="hidden" name="email" value={a.email} />
                      <select name="role" defaultValue={a.role}>
                        <option value="employee">Employee</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button type="submit" className="btn-sm">
                        Save
                      </button>
                    </form>
                  </td>
                  <td>
                    {registered.has(a.email.toLowerCase()) ? (
                      <span className="badge badge-ok">Registered</span>
                    ) : (
                      <span className="badge">Invited</span>
                    )}
                  </td>
                  <td className="right">
                    <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", alignItems: "center" }}>
                      <UserAccessControls email={a.email} isActive={a.is_active} />
                      <form action={removeAllowedEmail}>
                        <input type="hidden" name="email" value={a.email} />
                        <button type="submit" className="link-btn">
                          Remove
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {(allowed ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="muted-cell">
                    No one added yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ── Projects ───────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">Projects</h2>
          <form action={createProject} className="stack-form">
            <div className="field-row">
              <div className="field">
                <label>Project name</label>
                <input name="name" placeholder="e.g. Acme VM Buildout" required />
              </div>
              <div className="field">
                <label>VM / PiKVM link (Tailscale)</label>
                <input name="vm_host" placeholder="https://pikvm-acme.tailnet.ts.net" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Start date</label>
                <input name="starts_on" type="date" />
              </div>
              <div className="field">
                <label>End date</label>
                <input name="ends_on" type="date" />
              </div>
            </div>
            <div className="field">
              <label>Description</label>
              <input name="description" placeholder="Optional" />
            </div>
            <button type="submit" className="btn">
              Add project
            </button>
          </form>

          <table className="tbl">
            <thead>
              <tr>
                <th>Project</th>
                <th>Dates</th>
                <th>VM link</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(projects ?? []).flatMap((p) => [
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="muted-cell">
                    {p.starts_on || "—"} → {p.ends_on || "—"}
                  </td>
                  <td className="muted-cell">{p.vm_host || "—"}</td>
                  <td className="right">
                    <form action={deleteProject}>
                      <input type="hidden" name="id" value={p.id} />
                      <button type="submit" className="link-btn">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>,
                <tr key={p.id + "-creds"}>
                  <td colSpan={4} style={{ background: "#fcfdff" }}>
                    <AdminCredentials projectId={p.id} projectName={p.name} />
                  </td>
                </tr>,
              ])}
              {(projects ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="muted-cell">
                    No projects yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ── Assignments ────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">Assign people to projects</h2>
          <p className="intro">
            People appear here once they&apos;ve signed in at least once.
          </p>
          <form action={assignProject} className="inline-form">
            <select name="user_id" required defaultValue="">
              <option value="" disabled>
                Select person…
              </option>
              {(profiles ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name || p.email}
                </option>
              ))}
            </select>
            <select name="project_id" required defaultValue="">
              <option value="" disabled>
                Select project…
              </option>
              {(projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn">
              Assign
            </button>
          </form>

          <table className="tbl">
            <thead>
              <tr>
                <th>Person</th>
                <th>Project</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(assignments ?? []).map((a: any) => (
                <tr key={a.id}>
                  <td>{name(a.profiles)}</td>
                  <td>{a.projects?.name ?? "—"}</td>
                  <td className="right">
                    <form action={unassignProject}>
                      <input type="hidden" name="id" value={a.id} />
                      <button type="submit" className="link-btn">
                        Unassign
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {(assignments ?? []).length === 0 && (
                <tr>
                  <td colSpan={3} className="muted-cell">
                    No assignments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ── Timesheets ─────────────────────────────────────────── */}
        <section className="card">
          <h2 className="card-title">
            Logged hours{" "}
            <span className="count-pill">{totalHours} h total · last 100</span>
          </h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th>Person</th>
                <th>Project</th>
                <th>Hours</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {(timesheets ?? []).map((t: any, i) => (
                <tr key={i}>
                  <td>{t.work_date}</td>
                  <td>{name(t.profiles)}</td>
                  <td>{t.projects?.name ?? "—"}</td>
                  <td>{t.hours}</td>
                  <td className="muted-cell">{t.notes || "—"}</td>
                </tr>
              ))}
              {(timesheets ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="muted-cell">
                    No hours logged yet.
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
