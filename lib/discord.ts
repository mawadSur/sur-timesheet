// Read the latest messages from a Discord channel via the bot REST API.
// Requires DISCORD_BOT_TOKEN (a bot in your server with read access to the channel).
// No-ops cleanly when the token isn't set, so the rest of the app works without it.

export type DiscordMessage = { author: string; content: string; timestamp: string };

export async function fetchLatestMessages(
  channelId: string,
  limit = 25
): Promise<{ ok: boolean; messages?: DiscordMessage[]; error?: string }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: "DISCORD_BOT_TOKEN not set" };
  if (!channelId) return { ok: false, error: "No Discord channel configured" };

  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages?limit=${limit}`,
      {
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) {
      return { ok: false, error: `Discord API ${res.status}` };
    }
    const data = (await res.json()) as Array<{
      author?: { username?: string };
      content?: string;
      timestamp?: string;
    }>;
    // Discord returns newest-first; reverse to chronological.
    const messages = data
      .map((m) => ({
        author: m.author?.username ?? "unknown",
        content: m.content ?? "",
        timestamp: m.timestamp ?? "",
      }))
      .filter((m) => m.content.trim().length > 0)
      .reverse();
    return { ok: true, messages };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Flatten messages into a transcript for summarization. */
export function messagesToTranscript(messages: DiscordMessage[]): string {
  return messages
    .map((m) => `${m.author}: ${m.content}`)
    .join("\n")
    .slice(0, 6000);
}
