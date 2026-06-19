import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client that BYPASSES Row Level Security. Use ONLY in trusted
// server contexts that have no user session (e.g. the scheduled Discord pull).
// Requires SUPABASE_SERVICE_ROLE_KEY. Never import this into client code.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createSupabaseClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
