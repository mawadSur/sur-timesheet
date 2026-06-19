import { describe, it, expect } from "vitest";

// Integration smoke test: verifies Supabase Row Level Security prevents the
// anonymous role from reading sensitive tables. With RLS enabled and no
// permissive anon policy, an anonymous REST request should either return an
// empty array (all rows filtered out) or a permission/error status (>= 400).
// This hits the live network and is intentionally skipped when the Supabase
// env vars are absent (e.g. CI without secrets).

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const SENSITIVE_TABLES = ["credentials", "audit_log", "timesheets"] as const;

describe("Supabase RLS smoke (anonymous role)", () => {
  for (const table of SENSITIVE_TABLES) {
    it.skipIf(!url || !key)(
      `does not leak rows from "${table}" to the anonymous role`,
      async () => {
        const res = await fetch(
          `${url}/rest/v1/${table}?select=*&limit=1`,
          { headers: { apikey: key as string } }
        );

        let json: unknown;
        try {
          json = await res.json();
        } catch {
          // Non-JSON (e.g. error page) counts as "did not expose row data".
          json = null;
        }

        // The anonymous role must not be able to read protected rows:
        // RLS either filters everything (empty array) or the request fails.
        expect(Array.isArray(json) ? json.length === 0 : res.status >= 400).toBe(
          true
        );
      }
    );
  }
});
