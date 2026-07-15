"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { fetchLatestMessages, messagesToTranscript } from "@/lib/discord";
import { summarizeStatus } from "@/lib/summarize";

function s(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) || "").trim();
  return v || null;
}

// ── Edit a project's dashboard metadata ─────────────────────────────────────────
// Note: employment type (pay_type) is edited from the Pipeline / CRM section
// (updateOpportunity), so it is deliberately NOT touched here.
export async function updateProject(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;
  await supabase
    .from("projects")
    .update({
      status: s(formData, "status") || "Active",
      manager_name: s(formData, "manager_name"),
      it_support_phone: s(formData, "it_support_phone"),
      recruiter_email: s(formData, "recruiter_email"),
      discord_channel_id: s(formData, "discord_channel_id"),
      tailscale_tag: s(formData, "tailscale_tag"),
      starts_on: s(formData, "starts_on"),
      ends_on: s(formData, "ends_on"),
    })
    .eq("id", id);
  await logAudit("update_project", { target: id });
  revalidatePath("/admin/dashboard");
  revalidatePath(`/admin/projects/${id}`);
}

// ── Planned days off ────────────────────────────────────────────────────────────
export async function addTimeOff(formData: FormData) {
  const { supabase } = await requireAdmin();
  const project_id = String(formData.get("project_id") || "");
  const start_date = s(formData, "start_date");
  const end_date = s(formData, "end_date");
  if (!project_id || !start_date) return;
  await supabase.from("time_off").insert({
    project_id,
    user_id: s(formData, "user_id"),
    person_name: s(formData, "person_name"),
    start_date,
    end_date: end_date || start_date,
    note: s(formData, "note"),
  });
  await logAudit("add_time_off", { target: project_id });
  revalidatePath(`/admin/projects/${project_id}`);
}

export async function deleteTimeOff(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  const project_id = String(formData.get("project_id") || "");
  if (!id) return;
  await supabase.from("time_off").delete().eq("id", id);
  revalidatePath(`/admin/projects/${project_id}`);
}

// ── Pull + summarize the latest Discord status (manual, admin-triggered) ─────────
// Works as soon as DISCORD_BOT_TOKEN + ANTHROPIC_API_KEY are set. Stores an error
// note in the summary field if something's missing/unreachable, so it never throws.
export async function refreshDiscordStatus(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") || "");
  if (!id) return;

  const { data: project } = await supabase
    .from("projects")
    .select("discord_channel_id")
    .eq("id", id)
    .single();

  const channelId = project?.discord_channel_id;
  if (!channelId) {
    await supabase
      .from("projects")
      .update({ discord_status_summary: "No Discord channel set for this project.", discord_status_updated_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath(`/admin/projects/${id}`);
    return;
  }

  const fetched = await fetchLatestMessages(channelId);
  if (!fetched.ok || !fetched.messages) {
    await supabase
      .from("projects")
      .update({ discord_status_summary: `Could not read Discord: ${fetched.error}`, discord_status_updated_at: new Date().toISOString() })
      .eq("id", id);
    revalidatePath(`/admin/projects/${id}`);
    return;
  }

  const transcript = messagesToTranscript(fetched.messages);
  const summarized = await summarizeStatus(transcript);
  await supabase
    .from("projects")
    .update({
      discord_status_raw: transcript.slice(0, 4000),
      discord_status_summary: summarized.ok
        ? summarized.summary
        : `Pulled ${fetched.messages.length} messages, but summary failed: ${summarized.error}`,
      discord_status_updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  await logAudit("refresh_discord_status", { target: id });
  revalidatePath(`/admin/projects/${id}`);
}
