"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { grantTailscaleAccess, revokeTailscaleAccess } from "@/lib/tailscale";
import { grantDiscordChannelAccess, revokeDiscordChannelAccess } from "@/lib/discord";
import { sendInviteEmail } from "@/lib/email";
import { dollarsToCents } from "@/lib/books";
import { asPipelineStage, asPayType } from "@/lib/crm";
import type { RateState, AssignState, UnassignState } from "@/app/assignment-state";

// Valid account roles. "staff" is a restricted support type (logs hours, blocked
// from the credentials vault); "employee" is a normal consultant; "admin" manages.
const ROLES = ["employee", "staff", "admin"] as const;
const asRole = (v: FormDataEntryValue | null): "employee" | "staff" | "admin" => {
  const s = String(v ?? "");
  return (ROLES as readonly string[]).includes(s) ? (s as "employee" | "staff" | "admin") : "employee";
};

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// ── Employee: submit a timesheet ────────────────────────────────────────────────
type SubmitPayload = {
  date: string;
  entries: { projectId: string; hours: number; notes: string }[];
};

export async function submitTimesheet(payload: SubmitPayload) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session expired — please sign in again." };

  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
    return { ok: false, error: "Invalid date." };
  }

  const rows = (payload.entries || [])
    .map((e) => ({
      user_id: user.id,
      project_id: e.projectId,
      work_date: payload.date,
      hours: Number(e.hours),
      notes: (e.notes || "").slice(0, 500),
    }))
    .filter(
      (r) =>
        r.project_id &&
        Number.isFinite(r.hours) &&
        r.hours > 0 &&
        r.hours <= 24
    );

  if (rows.length === 0) {
    return { ok: false, error: "Add at least one project with hours." };
  }

  const { error } = await supabase.from("timesheets").insert(rows);
  if (error) {
    return {
      ok: false,
      error:
        "Could not save. You can only log hours for projects you're assigned to.",
    };
  }
  revalidatePath("/");
  return { ok: true, rows: rows.length };
}

// ── Admin: allowed emails / roles ────────────────────────────────────────────────
export async function addAllowedEmail(formData: FormData) {
  const { supabase } = await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = asRole(formData.get("role"));
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
  // Only a brand-new address gets an invite email — re-saving to change a
  // person's role shouldn't re-notify them.
  const { data: existing } = await supabase
    .from("allowed_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();
  await supabase.from("allowed_emails").upsert({ email, role });
  await logAudit("add_allowed_email", { target: email });
  if (!existing) {
    // Best-effort: tell them they can sign in now. No-ops when email isn't
    // configured (RESEND_API_KEY/INVITE_FROM_EMAIL unset); never blocks the add.
    await sendInviteEmail({ to: email });
  }
  revalidatePath("/admin");
}

export async function removeAllowedEmail(formData: FormData) {
  const { supabase } = await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email) return;
  // Lock out anyone who is already signed in — deleting the allowlist row alone
  // leaves their profiles.is_active true, so they'd keep their session until it
  // expires. Flip is_active first, then remove the allowlist entry.
  await supabase.from("profiles").update({ is_active: false }).eq("email", email);
  await supabase.from("allowed_emails").delete().eq("email", email);
  await logAudit("remove_allowed_email", { target: email });
  revalidatePath("/admin");
}

export async function setRole(formData: FormData) {
  const { supabase } = await requireAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = asRole(formData.get("role"));
  if (!email) return;
  await supabase.from("allowed_emails").update({ role }).eq("email", email);
  await supabase.from("profiles").update({ role }).eq("email", email);
  await logAudit("set_role", { target: email, metadata: { role } });
  revalidatePath("/admin");
}

// Set/correct a person's display name (e.g. to tell apart two accounts whose
// Google display name is identical). RLS `profiles_update_admin` is the backstop.
export async function setProfileName(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  const full_name = String(formData.get("full_name") || "").trim().slice(0, 120);
  if (!id) return;
  await supabase.from("profiles").update({ full_name: full_name || null }).eq("id", id);
  await logAudit("set_profile_name", { target: id, metadata: { full_name: full_name || null } });
  revalidatePath("/admin");
}

// ── Admin: projects ──────────────────────────────────────────────────────────────
export async function createProject(formData: FormData) {
  const { supabase } = await requireAdmin();
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  const { data: created } = await supabase
    .from("projects")
    .insert({
      name,
      description: String(formData.get("description") || "").trim() || null,
      starts_on: String(formData.get("starts_on") || "") || null,
      ends_on: String(formData.get("ends_on") || "") || null,
      vm_host: String(formData.get("vm_host") || "").trim() || null,
      pay_type: asPayType(String(formData.get("pay_type") || "") || undefined),
    })
    .select("id")
    .single();

  // Optional CRM fields let an incoming candidate be captured at creation. They
  // live in the admin-only project_crm table, never on the employee-readable
  // projects row. Only write a row when at least one field is set.
  if (created?.id) {
    const pipeline_stage = asPipelineStage(String(formData.get("pipeline_stage") || "") || undefined);
    const contact_name = String(formData.get("contact_name") || "").trim().slice(0, 120) || null;
    const contact_email = String(formData.get("contact_email") || "").trim().slice(0, 200) || null;
    const contact_phone = String(formData.get("contact_phone") || "").trim().slice(0, 60) || null;
    const estimated_value_cents = dollarsToCents(formData.get("estimated_value"));
    if (pipeline_stage || contact_name || contact_email || contact_phone || estimated_value_cents != null) {
      await supabase.from("project_crm").insert({
        project_id: created.id,
        pipeline_stage,
        contact_name,
        contact_email,
        contact_phone,
        estimated_value_cents,
      });
    }
  }
  await logAudit("create_project", { target: name });
  revalidatePath("/admin");
  revalidatePath("/admin/crm");
  revalidatePath("/admin/dashboard");
}

export async function deleteProject(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  await supabase.from("projects").delete().eq("id", id);
  await logAudit("delete_project", { target: id });
  revalidatePath("/admin");
}

// ── Best-effort access provisioning (network + comms) ────────────────────────────
// When a person is assigned to / removed from a project we grant / revoke their
// Tailscale (network) and Discord (comms) access. Every step is best-effort and
// total: the underlying lib fns no-op when their env vars / ids are unset, and
// these wrappers swallow any failure so provisioning can NEVER break an
// assignment or revocation.
type Supa = Awaited<ReturnType<typeof createClient>>;

type ProvisioningContext = {
  email: string | null;
  discordUserId: string | null;
  tailscaleTag: string | null;
  discordChannelId: string | null;
};

async function loadProvisioningContext(
  supabase: Supa,
  userId: string,
  projectId: string
): Promise<ProvisioningContext> {
  const ctx: ProvisioningContext = {
    email: null,
    discordUserId: null,
    tailscaleTag: null,
    discordChannelId: null,
  };
  try {
    const { data } = await supabase
      .from("projects")
      .select("tailscale_tag, discord_channel_id")
      .eq("id", projectId)
      .single();
    const p = data as { tailscale_tag?: string | null; discord_channel_id?: string | null } | null;
    ctx.tailscaleTag = p?.tailscale_tag ?? null;
    ctx.discordChannelId = p?.discord_channel_id ?? null;
  } catch {
    // Ignore — missing project just means nothing to provision.
  }
  try {
    const { data } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .single();
    ctx.email = (data as { email?: string | null } | null)?.email ?? null;
  } catch {
    // Ignore.
  }
  // discord_user_id is added by a later migration; read it on its own so a
  // missing column can't block the (independent) Tailscale grant above.
  try {
    const { data } = await supabase
      .from("profiles")
      .select("discord_user_id")
      .eq("id", userId)
      .single();
    ctx.discordUserId = (data as { discord_user_id?: string | null } | null)?.discord_user_id ?? null;
  } catch {
    // Column not present yet — Discord provisioning simply no-ops.
  }
  return ctx;
}

async function provisionAccess(supabase: Supa, userId: string, projectId: string): Promise<void> {
  try {
    const ctx = await loadProvisioningContext(supabase, userId, projectId);
    if (ctx.email && ctx.tailscaleTag) {
      await grantTailscaleAccess({ email: ctx.email, tag: ctx.tailscaleTag });
    }
    if (ctx.discordChannelId && ctx.discordUserId) {
      await grantDiscordChannelAccess({
        channelId: ctx.discordChannelId,
        discordUserId: ctx.discordUserId,
      });
    }
  } catch (e) {
    console.warn(`[provisionAccess] skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function deprovisionAccess(supabase: Supa, userId: string, projectId: string): Promise<void> {
  try {
    const ctx = await loadProvisioningContext(supabase, userId, projectId);
    if (ctx.email && ctx.tailscaleTag) {
      await revokeTailscaleAccess({ email: ctx.email, tag: ctx.tailscaleTag });
    }
    if (ctx.discordChannelId && ctx.discordUserId) {
      await revokeDiscordChannelAccess({
        channelId: ctx.discordChannelId,
        discordUserId: ctx.discordUserId,
      });
    }
  } catch (e) {
    console.warn(`[deprovisionAccess] skipped: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── Admin: assignments ───────────────────────────────────────────────────────────
// These three use the React 19 `useActionState` signature (prev, formData) and
// return inline status objects so the admin forms give per-row feedback with NO
// navigation / scroll-to-top. State contracts live in "@/app/assignment-state".
export async function assignProject(
  _prev: AssignState,
  formData: FormData
): Promise<AssignState> {
  const { supabase } = await requireAdmin();
  const user_id = String(formData.get("user_id") || "");
  const project_id = String(formData.get("project_id") || "");
  if (!user_id || !project_id) return { ok: false, error: "Pick a person and a project." };
  const { error } = await supabase
    .from("assignments")
    .upsert({ user_id, project_id }, { onConflict: "user_id,project_id" });
  if (error) return { ok: false, error: `Couldn't assign: ${error.message}` };
  await logAudit("assign", { metadata: { user_id, project_id } });
  // Best-effort grant network + comms access (the error path already returned).
  await provisionAccess(supabase, user_id, project_id);
  revalidatePath("/admin");
  return { ok: true, savedAt: Date.now() };
}

export async function unassignProject(
  _prev: UnassignState,
  formData: FormData
): Promise<UnassignState> {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("assignment_id") || "");
  if (!id) return { ok: false, error: "Missing assignment." };
  // Capture who/what this assignment was for BEFORE deleting, so we can revoke
  // their provisioned access afterwards.
  const { data: assignment } = await supabase
    .from("assignments")
    .select("user_id, project_id")
    .eq("id", id)
    .single();
  const { error } = await supabase.from("assignments").delete().eq("id", id);
  if (error) return { ok: false, error: `Couldn't unassign: ${error.message}` };
  await logAudit("unassign", { target: id });
  const a = assignment as { user_id?: string; project_id?: string } | null;
  if (a?.user_id && a?.project_id) {
    await deprovisionAccess(supabase, a.user_id, a.project_id);
  }
  revalidatePath("/admin");
  return { ok: true };
}

// ── Admin: per-assignment billing rates (money is admin-only) ────────────────────
// bill_rate = what the client pays/hour; pay_rate = what we pay the consultant/hour.
// An OMITTED field (not submitted at all — the admin never touched that input) is
// NOT present, so the caller carries forward the value in effect as of the chosen
// date. This is critical for back-dated corrections: editing just one rate must
// never overwrite the OTHER rate's real historical value with today's pre-filled
// number. A blank (submitted but empty) field is an intentional clear (-> null).
// An invalid entry (negative / NaN / absurd) is likewise not written, so a fat-
// fingered value can't silently wipe a previously-saved valid rate.
function parseRateField(v: FormDataEntryValue | null): { present: boolean; value: number | null } {
  if (v === null) return { present: false, value: null }; // field omitted -> carry forward
  const s = String(v).trim();
  if (s === "") return { present: true, value: null }; // intentional clear
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || n > 100000) return { present: false, value: null }; // invalid -> omit
  return { present: true, value: Math.round(n * 100) / 100 };
}

// Parse an optional "effective_from" (YYYY-MM-DD). Returns the date only if it is
// a REAL calendar date — the regex rejects out-of-range fields (2026-13-45) and
// the round-trip Date check rejects impossible days that pass the regex
// (2026-02-31 → March). Anything invalid/blank returns null so the caller
// defaults to today.
function parseEffectiveFrom(v: FormDataEntryValue | null): string | null {
  const s = String(v ?? "").trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

export async function setAssignmentRate(
  _prev: RateState,
  formData: FormData
): Promise<RateState> {
  const { supabase } = await requireAdmin();
  const assignment_id = String(formData.get("assignment_id") || "");
  if (!assignment_id) return { ok: false, error: "Missing assignment." };
  const bill = parseRateField(formData.get("bill_rate"));
  const pay = parseRateField(formData.get("pay_rate"));
  // A rate change takes effect on the CHOSEN date (defaulting to today); hours
  // already worked keep the rate that was in effect when they happened
  // (effective-dated history). An admin can back-date the row to correct a past
  // rate. Carry forward the value in effect AS OF the chosen date for any field
  // left blank, so setting just one rate doesn't null out the other.
  const today = new Date().toISOString().slice(0, 10);
  const chosenDate = parseEffectiveFrom(formData.get("effective_from")) ?? today;
  const { data: current } = await supabase
    .from("assignment_rates")
    .select("bill_rate, pay_rate")
    .eq("assignment_id", assignment_id)
    .lte("effective_from", chosenDate)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const payload: Record<string, unknown> = {
    assignment_id,
    effective_from: chosenDate,
    bill_rate: bill.present ? bill.value : current?.bill_rate == null ? null : Number(current.bill_rate),
    pay_rate: pay.present ? pay.value : current?.pay_rate == null ? null : Number(current.pay_rate),
    updated_at: new Date().toISOString(),
  };
  // Upsert the dated row (choosing a date that already has a row replaces it — a
  // true correction; a new date appends a row and preserves history).
  const { data, error } = await supabase
    .from("assignment_rates")
    .upsert(payload, { onConflict: "assignment_id,effective_from" })
    .select("bill_rate, pay_rate")
    .single();
  if (error) return { ok: false, error: `Couldn't save rate: ${error.message}` };
  await logAudit("set_rate", {
    target: assignment_id,
    metadata: {
      effective_from: chosenDate,
      bill_rate: bill.present ? bill.value : undefined,
      pay_rate: pay.present ? pay.value : undefined,
    },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/books");
  return {
    ok: true,
    savedAt: Date.now(),
    bill_rate: data?.bill_rate == null ? null : Number(data.bill_rate),
    pay_rate: data?.pay_rate == null ? null : Number(data.pay_rate),
  };
}
