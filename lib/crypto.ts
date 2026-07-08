import crypto from "node:crypto";

// App-level encryption for the credentials vault (AES-256-GCM).
// Ciphertext layout (base64): [ iv(12) | authTag(16) | ciphertext ]
// The key comes from CREDS_ENCRYPTION_KEY (64 hex chars or base64 of 32 bytes)
// by default, but encrypt/decrypt also accept an EXPLICIT key so out-of-band
// tooling (scripts/rotate-creds-key.mjs) can re-encrypt rows from an old key to
// a new one without touching the process env.

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

/**
 * Parse a raw key string into a 32-byte Buffer.
 * Accepts 64 hex chars, or base64 that decodes to 32 bytes.
 * Exported so the key-rotation script can validate/parse OLD_KEY / NEW_KEY the
 * exact same way the app does. Throws if the key is not 32 bytes.
 */
export function parseKey(raw: string): Buffer {
  if (!raw) throw new Error("Encryption key is empty");
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error("Encryption key must decode to 32 bytes (64 hex chars)");
  }
  return key;
}

function getEnvKey(): Buffer {
  const raw = process.env.CREDS_ENCRYPTION_KEY;
  if (!raw) throw new Error("CREDS_ENCRYPTION_KEY is not set");
  return parseKey(raw);
}

/**
 * Encrypt `plaintext` under AES-256-GCM. Defaults to the CREDS_ENCRYPTION_KEY
 * env key; pass an explicit 32-byte `key` to encrypt under a different key.
 */
export function encryptSecret(plaintext: string, key?: Buffer): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key ?? getEnvKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Decrypt a base64 payload produced by `encryptSecret`. Defaults to the
 * CREDS_ENCRYPTION_KEY env key; pass an explicit 32-byte `key` to decrypt under
 * a different key. Throws on a wrong key or tampered ciphertext (GCM auth tag).
 */
export function decryptSecret(payload: string, key?: Buffer): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key ?? getEnvKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
