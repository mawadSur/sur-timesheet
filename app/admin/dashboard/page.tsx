import Link from "next/link";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions";

// Inline-style colors for each status value.
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

export default async function Dashboard() {
  const supabase = await createClient();

  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, status, pay_type, ends_on, manager_name")
    .order("name");

  const list = (projects ?? []) as any[];

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">{BRAND.name.charAt(0)}</div>
          <div className="wordmark">
            {BRAND.name}
            <small>Dashboard</small>
          </div>
          <nav className="topnav">
            <Link className="navlink" href="/admin">
              Admin
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
          <h2 className="card-title">Projects</h2>
          <p className="intro">A card for every project. Open one to manage status, days off, Discord and credentials.</p>

          {list.length === 0 ? (
            <p className="muted-cell">No projects yet.</p>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 16,
                marginTop: 16,
              }}
            >
              {list.map((p) => (
                <Link
                  key={p.id}
                  href={`/admin/projects/${p.id}`}
                  style={{
                    display: "block",
                    textDecoration: "none",
                    color: "inherit",
                    border: "1px solid #e3e7ec",
                    borderRadius: 12,
                    padding: 16,
                    background: "#fff",
                    boxShadow: "0 1px 2px rgba(16,24,40,0.04)",
                  }}
                >
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 10 }}>{p.name}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                    <span style={{ ...badgeBase, ...statusStyle(p.status) }}>{p.status || "—"}</span>
                    <span
                      style={{
                        ...badgeBase,
                        background: "#f4f5f7",
                        color: "#444c56",
                        border: "1px solid #e3e7ec",
                      }}
                    >
                      {p.pay_type || "— pay"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "#5b6470" }}>
                    Manager: {p.manager_name || "—"}
                  </div>
                  {p.ends_on && (
                    <div style={{ fontSize: 13, color: "#5b6470", marginTop: 2 }}>
                      Ends: {p.ends_on}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
