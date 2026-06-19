"use client";

import { useState } from "react";
import { BRAND } from "@/config/timesheet";
import { createClient } from "@/lib/supabase/client";

export default function Login() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function signIn() {
    setError("");
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { access_type: "offline", prompt: "consent" },
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
    // On success the browser is redirected to Google.
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-logo">{BRAND.name.charAt(0)}</div>
        <h1 className="auth-title">{BRAND.name}</h1>
        <p className="auth-sub">{BRAND.tagline}</p>

        {error && <div className="alert alert-error">{error}</div>}

        <button className="google-btn" onClick={signIn} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
            />
            <path
              fill="#34A853"
              d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
            />
            <path
              fill="#FBBC05"
              d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
            />
            <path
              fill="#EA4335"
              d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
            />
          </svg>
          {busy ? "Redirecting…" : "Sign in with Google"}
        </button>

        <p className="auth-note">
          Access is invite-only. If your email hasn&apos;t been added, ask your
          manager.
        </p>
      </div>
      <p className="foot">{BRAND.name} Portal</p>
    </div>
  );
}
