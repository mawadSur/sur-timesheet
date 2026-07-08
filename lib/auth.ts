// Centralized admin gate for server actions. Loads the current user, throws
// "Not signed in." when there's no session, then verifies profiles.role ===
// 'admin' and throws "Admins only." otherwise. Returns the request-scoped
// Supabase client plus the authenticated user so callers can reuse both.
//
// This is a plain server-only module — NOT a "use server" actions file. Server
// actions import `requireAdmin` from here; RLS remains the backstop if this
// check were ever bypassed.
import { createClient } from "@/lib/supabase/server";

type Supa = Awaited<ReturnType<typeof createClient>>;
type AuthedUser = NonNullable<
  Awaited<ReturnType<Supa["auth"]["getUser"]>>["data"]["user"]
>;

export async function requireAdmin(): Promise<{ supabase: Supa; user: AuthedUser }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in.");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("Admins only.");
  return { supabase, user };
}
