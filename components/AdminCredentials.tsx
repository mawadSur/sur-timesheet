import { createClient } from "@/lib/supabase/server";
import { addCredential, deleteCredential } from "@/app/credentials-actions";

type CredentialRow = {
  id: string;
  label: string;
  username: string | null;
  url: string | null;
  notes: string | null;
};

export default async function AdminCredentials({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const supabase = await createClient();
  // Admin session; RLS permits. Never select the ciphertext into the page.
  const { data: rows } = await supabase
    .from("credentials")
    .select("id, label, username, url, notes")
    .eq("project_id", projectId)
    .order("label");

  const creds = (rows ?? []) as CredentialRow[];

  return (
    <div style={{ marginTop: 12 }}>
      <table className="tbl">
        <thead>
          <tr>
            <th>Label</th>
            <th>Username</th>
            <th>URL</th>
            <th>Notes</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {creds.map((c) => (
            <tr key={c.id}>
              <td>{c.label}</td>
              <td className="muted-cell">{c.username || "—"}</td>
              <td className="muted-cell">{c.url || "—"}</td>
              <td className="muted-cell">{c.notes || "—"}</td>
              <td className="right">
                <form action={deleteCredential}>
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className="link-btn">
                    Delete
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {creds.length === 0 && (
            <tr>
              <td colSpan={5} className="muted-cell">
                No credentials for {projectName} yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form action={addCredential} className="inline-form" style={{ marginTop: 12 }}>
        <input type="hidden" name="project_id" value={projectId} />
        <input name="label" placeholder="Label (e.g. Root SSH)" required />
        <input name="username" placeholder="Username" />
        <input
          name="secret"
          type="password"
          placeholder="secret / password"
          required
        />
        <input name="url" placeholder="URL (optional)" />
        <input name="notes" placeholder="Notes (optional)" />
        <button type="submit" className="btn btn-sm">
          Add credential
        </button>
      </form>
    </div>
  );
}
