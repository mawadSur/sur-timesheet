// Summarize a Discord transcript into a short project-status blurb using the
// Claude API. Requires ANTHROPIC_API_KEY. No-ops cleanly when unset.

export async function summarizeStatus(
  transcript: string
): Promise<{ ok: boolean; summary?: string; error?: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, error: "ANTHROPIC_API_KEY not set" };
  if (!transcript.trim()) return { ok: false, error: "No messages to summarize" };

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5",
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content:
              "These are the latest messages from a project's Discord channel. " +
              "Summarize the current project status in 2-3 sentences: where things stand, " +
              "any blockers, and the next steps. Be concise and factual.\n\n" +
              transcript,
          },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return { ok: false, error: `Anthropic API ${res.status}` };
    }
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    const summary = data.content?.[0]?.text?.trim() ?? "";
    if (!summary) return { ok: false, error: "Empty summary" };
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
