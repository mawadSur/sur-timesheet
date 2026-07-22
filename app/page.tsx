import Link from "next/link";
import { redirect } from "next/navigation";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";
import { getWeek } from "@/app/timesheet-actions";
import { currentWeekStart } from "@/lib/week";
import { projectPhase } from "@/lib/dates";
import WeeklyTimesheet, { type ProjectOption } from "@/components/WeeklyTimesheet";
import CredentialsPanel from "@/components/CredentialsPanel";

type ProjectRow = ProjectOption & {
  starts_on: string | null;
  ends_on: string | null;
};

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, role")
    .eq("id", user.id)
    .single();

  // RLS decides the scope: admins and staff get every project, employees get
  // the ones they're assigned to.
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, starts_on, ends_on")
    .order("name");

  const isAdmin = profile?.role === "admin";
  // Staff are a restricted support type: they see every project and can log
  // hours against any of them, but never the credentials vault (RLS enforces
  // that too — this just hides the reveal panel) and never company finances.
  const isStaff = profile?.role === "staff";
  const firstName = (profile?.full_name || profile?.email || "there").split(" ")[0];

  const rows = (projects as ProjectRow[]) ?? [];
  const options: ProjectOption[] = rows.map((p) => ({ id: p.id, name: p.name }));

  // The week the grid opens on. getWeek is RLS-scoped to this user.
  const weekStart = currentWeekStart();
  const loaded = await getWeek(weekStart);
  const week = loaded.ok
    ? loaded.data
    : { weekStart, submitted: false, locked: false, editable: true, entries: [] };

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">{BRAND.name.charAt(0)}</div>
          <div className="wordmark">
            {BRAND.name}
            <small>{BRAND.tagline}</small>
          </div>
          <nav className="topnav">
            <Link className="navlink" href="/pay">
              My pay
            </Link>
            {isAdmin && (
              <Link className="navlink" href="/admin">
                Admin
              </Link>
            )}
            <form action={signOut}>
              <button type="submit" className="navlink navbtn">
                Log out
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="page">
        <p className="greeting">Hi {firstName} — log your hours for the week.</p>

        <section className="card">
          <div className="section-head" style={{ margin: "0 0 12px" }}>
            <h2>Projects</h2>
            <span className="count-pill">{rows.length}</span>
          </div>
          {rows.length === 0 ? (
            <p className="intro" style={{ margin: 0 }}>
              No projects yet. Once you&apos;re assigned to one it appears here.
            </p>
          ) : (
            <ul className="proj-chips">
              {rows.map((p) => {
                const phase = projectPhase(p.starts_on, p.ends_on);
                return (
                  <li key={p.id} className={`proj-chip ${phase}`}>
                    <span>{p.name}</span>
                    {phase !== "active" && <em>{phase}</em>}
                  </li>
                );
              })}
            </ul>
          )}
          {isStaff && rows.length > 0 && (
            <p className="intro" style={{ margin: "12px 0 0" }}>
              You can see and log hours against every project.
            </p>
          )}
        </section>

        {!isStaff && rows.map((p) => (
          <CredentialsPanel key={p.id} projectId={p.id} projectName={p.name} />
        ))}

        <WeeklyTimesheet projects={options} initialWeek={week} maxWeekStart={weekStart} />

        <p className="foot">
          {BRAND.name} Portal · {profile?.email}
        </p>
      </main>
    </>
  );
}
