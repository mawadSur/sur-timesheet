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

// ── Channel access provisioning ──────────────────────────────────────────────────
// Grant/revoke a single member's VIEW_CHANNEL permission on a Discord channel by
// writing/removing a per-member permission overwrite. Requires DISCORD_BOT_TOKEN
// (a bot with Manage Roles on that channel). No-ops cleanly when the token,
// channelId, or discordUserId is missing; never throws. Best-effort — the caller
// (project assign/unassign) must not break if provisioning fails.

// VIEW_CHANNEL permission bit (1 << 10). Discord uses stringified bitfields.
const VIEW_CHANNEL = "1024";

export async function grantDiscordChannelAccess({
  channelId,
  discordUserId,
}: {
  channelId?: string | null;
  discordUserId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: "DISCORD_BOT_TOKEN not set" };
  if (!channelId || !discordUserId) return { ok: false, error: "Missing channel or user id" };

  try {
    // PUT a member (type 1) permission overwrite that allows VIEW_CHANNEL.
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/permissions/${discordUserId}`,
      {
        method: "PUT",
        headers: { Authorization: `Bot ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ type: 1, allow: VIEW_CHANNEL, deny: "0" }),
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return { ok: false, error: `Discord API ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function revokeDiscordChannelAccess({
  channelId,
  discordUserId,
}: {
  channelId?: string | null;
  discordUserId?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) return { ok: false, error: "DISCORD_BOT_TOKEN not set" };
  if (!channelId || !discordUserId) return { ok: false, error: "Missing channel or user id" };

  try {
    // DELETE the member permission overwrite (removes the VIEW_CHANNEL grant).
    const res = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/permissions/${discordUserId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bot ${token}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) return { ok: false, error: `Discord API ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
