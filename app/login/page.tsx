"use client";

import { useState } from "react";
import { BRAND } from "@/config/timesheet";

function safeNext(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next");
  // Only allow internal paths to avoid open-redirects.
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

export default function Login() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!passcode.trim()) {
      setError("Enter the team passcode.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Could not log in.");
      }
      window.location.href = safeNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log in.");
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">{BRAND.name.charAt(0)}</div>
        <h1 className="auth-title">{BRAND.name}</h1>
        <p className="auth-sub">{BRAND.tagline}</p>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="passcode">Team passcode</label>
            <input
              id="passcode"
              type="password"
              autoComplete="current-password"
              placeholder="Enter the code your manager shared"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              autoFocus
            />
          </div>
          <button className="submit" type="submit" disabled={busy}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>
      </div>
      <p className="foot">{BRAND.name} Timesheet</p>
    </div>
  );
}
