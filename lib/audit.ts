import { createClient } from "@/lib/supabase/server";

/**
 * Append an entry to the audit_log. Best-effort: a logging failure must never
 * break the action that triggered it. Never pass secret values as target/metadata.
 *
 * Common actions: 'view_credential', 'create_credential', 'update_credential',
 * 'delete_credential', 'assign', 'unassign', 'create_project', 'delete_project',
 * 'revoke_user', 'restore_user', 'add_allowed_email', 'remove_allowed_email'.
 */
export async function logAudit(
  action: string,
  opts?: { target?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("audit_log").insert({
      actor_id: user?.id ?? null,
      actor_email: user?.email ?? null,
      action,
      target: opts?.target ?? null,
      metadata: opts?.metadata ?? null,
    });
  } catch {
    // Swallow — audit logging is never allowed to break the caller.
  }
}
