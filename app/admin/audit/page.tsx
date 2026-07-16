import { createClient } from "@/lib/supabase/server";

export default async function AuditLog() {
  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, actor_email, action, target, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  const entries = (rows ?? []) as any[];

  return (
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
  );
}
