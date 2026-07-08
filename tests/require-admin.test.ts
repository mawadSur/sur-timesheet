import { describe, it, expect, vi, beforeEach } from "vitest";

// Mutable fake-session state, shared with the hoisted vi.mock factory below.
const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  profile: null as { role: string } | null,
}));

// Mock the Supabase server client so requireAdmin runs with no network / cookies.
// The chain mirrors: supabase.from("profiles").select("role").eq("id", …).single().
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: async () => ({ data: { user: state.user } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: state.profile }),
        }),
      }),
    }),
  })),
}));

import { requireAdmin } from "../lib/auth";

beforeEach(() => {
  state.user = null;
  state.profile = null;
});

describe("requireAdmin", () => {
  it("throws 'Not signed in.' when there is no session", async () => {
    state.user = null;
    await expect(requireAdmin()).rejects.toThrow("Not signed in.");
  });

  it("throws 'Admins only.' for a signed-in non-admin (employee)", async () => {
    state.user = { id: "u1" };
    state.profile = { role: "employee" };
    await expect(requireAdmin()).rejects.toThrow("Admins only.");
  });

  it("throws 'Admins only.' for a staff role", async () => {
    state.user = { id: "u1" };
    state.profile = { role: "staff" };
    await expect(requireAdmin()).rejects.toThrow("Admins only.");
  });

  it("throws 'Admins only.' when the profile row is missing", async () => {
    state.user = { id: "u1" };
    state.profile = null;
    await expect(requireAdmin()).rejects.toThrow("Admins only.");
  });

  it("resolves { supabase, user } for an admin", async () => {
    state.user = { id: "admin-1" };
    state.profile = { role: "admin" };
    const res = await requireAdmin();
    expect(res.user).toEqual({ id: "admin-1" });
    expect(res.supabase).toBeDefined();
    expect(typeof res.supabase.from).toBe("function");
  });
});
