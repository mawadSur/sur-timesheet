import { createAdminClient } from "@/lib/supabase/admin";
import { fetchLatestMessages, messagesToTranscript } from "@/lib/discord";
import { summarizeStatus } from "@/lib/summarize";

// Scheduled Discord status pull. Runs with NO user session via the Supabase
// service-role client. For each project with a Discord channel, reads the
// latest messages, summarizes them with Claude, and stores the result on the
// project row. Everything degrades gracefully when env vars are missing.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectRow = { id: string; name: string | null; discord_channel_id: string | null };

export async function GET(req: Request) {
  // Auth: fail closed. This route is exempt from the middleware auth gate (see
  // the /api/cron public prefix), so it must authorize itself. Require the
  // Bearer header that Vercel Cron sends automatically. If CRON_SECRET is not
  // configured we reject rather than run the job, so the endpoint is never
  // publicly reachable (which would let anyone trigger Discord fetch + Claude
  // summarization).
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const header = req.headers.get("authorization");
  if (header !== `Bearer ${cronSecret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Service-role client. Null when SUPABASE_SERVICE_ROLE_KEY/URL aren't set.
  const supabase = createAdminClient();
  if (!supabase) {
    return Response.json({
      ok: false,
      skipped: "SUPABASE_SERVICE_ROLE_KEY not set",
    });
  }

  // Short-circuit gracefully when the dependent integrations aren't configured.
  if (!process.env.DISCORD_BOT_TOKEN) {
    return Response.json({ ok: false, skipped: "DISCORD_BOT_TOKEN not set" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, skipped: "ANTHROPIC_API_KEY not set" });
  }

  // All projects that have a Discord channel wired up.
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, discord_channel_id")
    .not("discord_channel_id", "is", null);

  if (error) {
    return Response.json(
      { ok: false, error: `Failed to load projects: ${error.message}` },
      { status: 500 }
    );
  }

  const projects = (data ?? []) as ProjectRow[];
  let succeeded = 0;
  let failed = 0;

  for (const project of projects) {
    const channelId = project.discord_channel_id;
    if (!channelId) {
      failed += 1;
      continue;
    }

    try {
      const fetched = await fetchLatestMessages(channelId);
      if (!fetched.ok || !fetched.messages) {
        // Record the error as the summary so it surfaces in the UI, but don't
        // abort the whole run for one bad channel.
        const note = `Status unavailable: ${fetched.error ?? "could not fetch messages"}`;
        await supabase
          .from("projects")
          .update({
            discord_status_summary: note,
            discord_status_updated_at: new Date().toISOString(),
          })
          .eq("id", project.id);
        failed += 1;
        continue;
      }

      const transcript = messagesToTranscript(fetched.messages);
      const summarized = await summarizeStatus(transcript);

      const summary = summarized.ok
        ? summarized.summary ?? ""
        : `Status unavailable: ${summarized.error ?? "summarization failed"}`;

      await supabase
        .from("projects")
        .update({
          discord_status_raw: transcript.slice(0, 4000),
          discord_status_summary: summary,
          discord_status_updated_at: new Date().toISOString(),
        })
        .eq("id", project.id);

      if (summarized.ok) {
        succeeded += 1;
      } else {
        failed += 1;
      }
    } catch {
      // Per-project guard: a single failure must never abort the batch. We
      // intentionally don't include the error detail in the response.
      failed += 1;
    }
  }

  return Response.json({
    ok: true,
    processed: projects.length,
    succeeded,
    failed,
  });
}
