import Link from "next/link";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";

export default async function AuditLog() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, actor_email, action, target, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const entries = (rows ?? []) as any[];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">{BRAND.name.charAt(0)}</div>
          <div className="wordmark">
            {BRAND.name}
            <small>Audit log</small>
          </div>
          <nav className="topnav">
            <Link className="navlink" href="/admin">
              Admin
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
          <h2 className="card-title">
            Audit log <span className="count-pill">last 200</span>
          </h2>
          <table className="tbl">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.created_at).toLocaleString()}</td>
                  <td>{e.actor_email || "—"}</td>
                  <td>
                    <span className="badge">{e.action}</span>
                  </td>
                  <td className="muted-cell">{e.target || "—"}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted-cell">
                    No activity yet.
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
