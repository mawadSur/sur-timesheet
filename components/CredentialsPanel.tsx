"use client";

import { useState } from "react";
import { getProjectCredentials } from "@/app/credentials-actions";

type RevealedCredential = {
  id: string;
  label: string;
  username: string | null;
  secret: string;
  url: string | null;
  notes: string | null;
};

type Loaded = {
  credentials: RevealedCredential[];
  vmHost: string | null;
  pikvmHost: string | null;
};

export default function CredentialsPanel({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState<Loaded | null>(null);
  // Track which secrets are currently shown (by credential id).
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // Each click triggers a fresh server call so every reveal is audit-logged.
  async function reveal() {
    setError("");
    setLoading(true);
    const res = await getProjectCredentials(projectId);
    setLoading(false);
    if (!res.ok) {
      setData(null);
      setError(res.error || "Could not load credentials.");
      return;
    }
    setData({
      credentials: res.credentials,
      vmHost: res.vmHost,
      pikvmHost: res.pikvmHost,
    });
    setShown({});
  }

  function toggle(id: string) {
    setShown((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function copy(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500);
    } catch {
      // Clipboard may be unavailable (insecure context) — ignore quietly.
    }
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 className="card-title">{projectName}</h2>

      {error && <div className="alert alert-error">{error}</div>}

      {!data && (
        <button className="btn" onClick={reveal} disabled={loading}>
          {loading ? "Loading…" : "Show credentials"}
        </button>
      )}

      {data && (
        <>
          {(data.vmHost || data.pikvmHost) && (
            <div className="intro" style={{ margin: "12px 0" }}>
              {data.vmHost && (
                <div>
                  VM:{" "}
                  <a href={data.vmHost} target="_blank" rel="noreferrer">
                    {data.vmHost}
                  </a>
                </div>
              )}
              {data.pikvmHost && (
                <div>
                  PiKVM:{" "}
                  <a href={data.pikvmHost} target="_blank" rel="noreferrer">
                    {data.pikvmHost}
                  </a>
                </div>
              )}
            </div>
          )}

          {data.credentials.length === 0 ? (
            <p className="intro" style={{ marginTop: 12 }}>
              No credentials for this project.
            </p>
          ) : (
            <table className="tbl" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Username</th>
                  <th>Secret</th>
                  <th>Link</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {data.credentials.map((c) => (
                  <tr key={c.id}>
                    <td>{c.label}</td>
                    <td className="muted-cell">{c.username || "—"}</td>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <code
                          style={{
                            fontFamily: "ui-monospace, monospace",
                            fontSize: 13,
                          }}
                        >
                          {shown[c.id] ? c.secret : "••••••••"}
                        </code>
                        <button
                          type="button"
                          className="btn-sm"
                          onClick={() => toggle(c.id)}
                        >
                          {shown[c.id] ? "Hide" : "Show"}
                        </button>
                        <button
                          type="button"
                          className="btn-sm"
                          onClick={() => copy(c.id, c.secret)}
                        >
                          {copied === c.id ? "Copied!" : "Copy"}
                        </button>
                      </span>
                    </td>
                    <td className="muted-cell">
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="muted-cell">{c.notes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ marginTop: 12 }}>
            <button className="btn-sm" onClick={reveal} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
