import Link from "next/link";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import {
  addAllowedEmail,
  removeAllowedEmail,
  setRole,
  createProject,
  deleteProject,
  setProfileName,
  signOut,
} from "@/app/actions";
import AdminCredentials from "@/components/AdminCredentials";
import UserAccessControls from "@/components/UserAccessControls";
import AssignPersonForm from "@/components/AssignPersonForm";
import AssignmentRateForm from "@/components/AssignmentRateForm";
import UnassignButton from "@/components/UnassignButton";
import { projectPhase } from "@/lib/dates";
import { latestRateByAssignment } from "@/lib/books";

type Named = { full_name: string | null; email: string } | null;

// Auto-computed lifecycle badge from the date window (separate from the manual
// status field). Uses the shared .badge classes.
function PhaseBadge({
  starts_on,
  ends_on,
}: {
  starts_on: string | null;
  ends_on: string | null;
}) {
  const phase = projectPhase(starts_on, ends_on);
  if (phase === "ended") return <span className="badge">Ended</span>;
  if (phase === "upcoming") return <span className="badge">Upcoming</span>;
  return <span className="badge badge-ok">Active</span>;
}

export default async function Admin() {
  const supabase = await createClient();

  const [
    { data: allowed },
    { data: profiles },
    { data: projects },
    { data: assignments },
    { data: rates },
    { data: timesheets },
  ] = await Promise.all([
    supabase.from("allowed_emails").select("email, role, is_active").order("email"),
    supabase.from("profiles").select("id, full_name, email, role").order("email"),
    supabase.from("projects").select("id, name, starts_on, ends_on, vm_host").order("name"),
    supabase
      .from("assignments")
      .select("id, profiles(full_name, email), projects(name)")
      .order("assigned_at", { ascending: false }),
    supabase.from("assignment_rates").select("assignment_id, bill_rate, pay_rate, effective_from"),
    supabase
      .from("timesheets")
      .select("work_date, hours, notes, profiles(full_name, email), projects(name)")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const registered = new Set((profiles ?? []).map((p) => p.email.toLowerCase()));
  const profileByEmail = new Map(
    (profiles ?? []).map((p) => [p.email.toLowerCase(), p])
  );
  // Current rate per assignment (latest effective_from on or before today).
  const today = new Date().toISOString().slice(0, 10);
  const rateByAssignment = latestRateByAssignment(rates, today);
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
            <Link className="navlink" href="/admin/dashboard">
              Dashboard
            </Link>
            <Link className="navlink" href="/admin/crm">
              CRM
            </Link>
            <Link className="navlink" href="/admin/books">
              Books
            </Link>
            <Link className="navlink" href="/admin/payroll">
              Payroll
            </Link>
            <Link className="navlink" href="/admin/payroll/runs">
              Payroll runs
            </Link>
            <Link className="navlink" href="/admin/invoices">
              Invoices
            </Link>
            <Link className="navlink" href="/admin/rescuetime">
              RescueTime
            </Link>
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
              <option value="staff">Staff</option>
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
                <th>Name</th>
                <th>Role</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(allowed ?? []).map((a) => {
                const prof = profileByEmail.get(a.email.toLowerCase());
                return (
                <tr key={a.email}>
                  <td>{a.email}</td>
                  <td>
                    {prof ? (
                      <form action={setProfileName} className="row-form">
                        <input type="hidden" name="id" value={prof.id} />
                        <input
                          name="full_name"
                          defaultValue={prof.full_name || ""}
                          placeholder="Add name"
                          style={{ maxWidth: 170 }}
                        />
                        <button type="submit" className="btn-sm">
                          Save
                        </button>
                      </form>
                    ) : (
                      <span className="muted-cell">After sign-in</span>
                    )}
                  </td>
                  <td>
                    <form action={setRole} className="row-form">
                      <input type="hidden" name="email" value={a.email} />
                      <select name="role" defaultValue={a.role}>
                        <option value="employee">Employee</option>
                        <option value="staff">Staff</option>
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
                      <UserAccessControls email={a.email} isActive={a.is_active} profileId={prof?.id ?? null} />
                      <form action={removeAllowedEmail}>
                        <input type="hidden" name="email" value={a.email} />
                        <button type="submit" className="link-btn">
                          Remove
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
                );
              })}
              {(allowed ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="muted-cell">
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
            <div className="field-row">
              <div className="field">
                <label>Pipeline stage (optional)</label>
                <select name="pipeline_stage" defaultValue="">
                  <option value="">— Not a candidate —</option>
                  <option value="Offer">Offer</option>
                  <option value="Background check">Background check</option>
                  <option value="Expected start">Expected start</option>
                </select>
              </div>
              <div className="field">
                <label>Rate ($/hr)</label>
                <input name="estimated_value" type="number" step="0.01" min="0" placeholder="e.g. 85" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Contact (optional)</label>
                <input name="contact_name" placeholder="Point of contact" />
              </div>
              <div className="field">
                <label>Contact email (optional)</label>
                <input name="contact_email" type="email" placeholder="name@company.com" />
              </div>
            </div>
            <div className="field-row">
              <div className="field">
                <label>Contact phone (optional)</label>
                <input name="contact_phone" type="tel" placeholder="+1 555 000 0000" />
              </div>
              <div className="field">
                <label>Employment type (optional)</label>
                <select name="pay_type" defaultValue="">
                  <option value="">—</option>
                  <option value="W2">W2</option>
                  <option value="1099">1099</option>
                  <option value="C2C">C2C</option>
                </select>
              </div>
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
                  <td>
                    <Link href={`/admin/projects/${p.id}`}>{p.name}</Link>
                  </td>
                  <td className="muted-cell">
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {p.starts_on || "—"} → {p.ends_on || "—"}
                      <PhaseBadge starts_on={p.starts_on} ends_on={p.ends_on} />
                    </span>
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
            People appear here once they&apos;ve signed in at least once. Set a
            bill rate (what the client pays) and pay rate (what the consultant
            earns) per assignment &mdash; these are admin-only and drive the{" "}
            <Link href="/admin/books">Books</Link>.
          </p>
          <AssignPersonForm people={profiles ?? []} projects={projects ?? []} />

          <table className="tbl">
            <thead>
              <tr>
                <th>Person</th>
                <th>Project</th>
                <th>Bill / Pay ($/h)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(assignments ?? []).map((a: any) => (
                <tr key={a.id}>
                  <td>{name(a.profiles)}</td>
                  <td>{a.projects?.name ?? "—"}</td>
                  <td>
                    <AssignmentRateForm
                      assignmentId={a.id}
                      billRate={
                        rateByAssignment.get(a.id)?.bill_rate == null
                          ? null
                          : Number(rateByAssignment.get(a.id)?.bill_rate)
                      }
                      payRate={
                        rateByAssignment.get(a.id)?.pay_rate == null
                          ? null
                          : Number(rateByAssignment.get(a.id)?.pay_rate)
                      }
                    />
                  </td>
                  <td className="right">
                    <UnassignButton assignmentId={a.id} />
                  </td>
                </tr>
              ))}
              {(assignments ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="muted-cell">
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
