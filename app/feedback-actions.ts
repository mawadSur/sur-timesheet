"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

function s(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) || "").trim();
  return v || null;
}

const MAX_BODY = 5000;

export type FeedbackRow = {
  id: string;
  project_id: string;
  subject_profile_id: string | null;
  author_id: string;
  body: string;
  created_at: string;
  author_name: string | null;
  subject_name: string | null;
};

// ── Add a feedback note to a project (optionally about a person) ─────────────────
export async function addFeedback(formData: FormData) {
  const { supabase } = await requireAdmin();
  const project_id = String(formData.get("project_id") || "");
  const body = String(formData.get("body") || "").trim().slice(0, MAX_BODY);
  const subject_profile_id = s(formData, "subject_profile_id");
  if (!project_id || !body) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase.from("feedback").insert({
    project_id,
    subject_profile_id,
    author_id: user.id,
    body,
  });
  // Never log the feedback body — ids only.
  await logAudit("add_feedback", {
    target: project_id,
    metadata: { subject_profile_id: subject_profile_id ?? null },
  });
  revalidatePath(`/admin/projects/${project_id}`);
}

// ── Delete a feedback note ───────────────────────────────────────────────────────
export async function deleteFeedback(id: string) {
  const { supabase } = await requireAdmin();
  if (!id) return;
  const { data: row } = await supabase
    .from("feedback")
    .select("project_id")
    .eq("id", id)
    .single();
  await supabase.from("feedback").delete().eq("id", id);
  await logAudit("delete_feedback", { target: id });
  if (row?.project_id) revalidatePath(`/admin/projects/${row.project_id}`);
}

// A joined profile relation from Supabase can arrive as an object or a 1-row array.
function pickProfile(
  rel: unknown
): { full_name: string | null; email: string | null } | null {
  if (!rel) return null;
  const p = Array.isArray(rel) ? rel[0] : rel;
  if (!p || typeof p !== "object") return null;
  return p as { full_name: string | null; email: string | null };
}

// ── Read a project's feedback (newest first), with author & subject names ─────────
// Read-only: relies on RLS (admins see all rows; a subject sees their own).
export async function getProjectFeedback(
  projectId: string
): Promise<FeedbackRow[]> {
  if (!projectId) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("feedback")
    .select(
      `id, project_id, subject_profile_id, author_id, body, created_at,
       author:profiles!feedback_author_id_fkey ( full_name, email ),
       subject:profiles!feedback_subject_profile_id_fkey ( full_name, email )`
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];

  return data.map((r) => {
    const author = pickProfile((r as { author?: unknown }).author);
    const subject = pickProfile((r as { subject?: unknown }).subject);
    return {
      id: r.id as string,
      project_id: r.project_id as string,
      subject_profile_id: (r.subject_profile_id as string | null) ?? null,
      author_id: r.author_id as string,
      body: r.body as string,
      created_at: r.created_at as string,
      author_name: author ? author.full_name || author.email : null,
      subject_name: subject ? subject.full_name || subject.email : null,
    };
  });
}
