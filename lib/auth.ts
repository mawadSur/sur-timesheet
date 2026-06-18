// Tiny shared-passcode auth. Works in both the Edge middleware and Node routes
// using the Web Crypto API (HMAC-SHA256 signed, expiring session token).

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = "sur_session";
const encoder = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return toHex(sig);
}

/** Constant-time-ish string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Create a signed, expiring session token. */
export async function createSessionToken(secret: string): Promise<string> {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const sig = await hmac(secret, exp);
  return `${exp}.${sig}`;
}

/** Verify a session token's signature and that it hasn't expired. */
export async function verifySessionToken(
  secret: string,
  token: string | undefined | null
): Promise<boolean> {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const exp = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  const expected = await hmac(secret, exp);
  return safeEqual(sig, expected);
}

export const SESSION_MAX_AGE = SESSION_TTL_MS / 1000;
