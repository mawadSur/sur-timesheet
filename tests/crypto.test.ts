import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret } from "../lib/crypto";

// Sanity: the deterministic test key is injected via vitest.config.ts `test.env`.
describe("lib/crypto", () => {
  const samples = [
    "hello world",
    "p@ssw0rd!#$%^&*()",
    "unicode: café — naïve — 日本語 — 🔐🚀",
    "", // empty string
    "a".repeat(10_000), // long value
  ];

  it("round-trips: decryptSecret(encryptSecret(x)) === x", () => {
    for (const x of samples) {
      expect(decryptSecret(encryptSecret(x))).toBe(x);
    }
  });

  it("produces ciphertext that differs from the plaintext", () => {
    const plaintext = "super-secret-token";
    const ciphertext = encryptSecret(plaintext);
    expect(ciphertext).not.toBe(plaintext);
  });

  it("produces valid base64 output", () => {
    const ciphertext = encryptSecret("some secret value");
    // base64 alphabet only (with optional padding)
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    // round-trips through Buffer without corruption
    expect(Buffer.from(ciphertext, "base64").toString("base64")).toBe(ciphertext);
  });

  it("is non-deterministic: same plaintext yields different ciphertext (random IV)", () => {
    const plaintext = "repeat-me";
    const a = encryptSecret(plaintext);
    const b = encryptSecret(plaintext);
    expect(a).not.toBe(b);
    // Both must still decrypt back to the original.
    expect(decryptSecret(a)).toBe(plaintext);
    expect(decryptSecret(b)).toBe(plaintext);
  });

  it("detects tampering: flipping a byte makes decryptSecret throw (GCM auth tag)", () => {
    const ciphertext = encryptSecret("tamper-target");
    const buf = Buffer.from(ciphertext, "base64");
    // Flip a byte in the ciphertext body (after iv[12] + tag[16]) so the
    // GCM authentication tag no longer matches the decrypted data.
    const idx = buf.length - 1;
    buf[idx] = buf[idx] ^ 0xff;
    const tampered = buf.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("detects a corrupted auth tag", () => {
    const ciphertext = encryptSecret("tag-target");
    const buf = Buffer.from(ciphertext, "base64");
    // Flip a byte inside the auth tag region (bytes 12..28).
    buf[13] = buf[13] ^ 0xff;
    const tampered = buf.toString("base64");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("fails to decrypt ciphertext encrypted under a different key", () => {
    const plaintext = "wrong-key-test";
    const ciphertext = encryptSecret(plaintext);

    const original = process.env.CREDS_ENCRYPTION_KEY;
    try {
      // Swap in a different valid 32-byte key, then attempt to decrypt.
      process.env.CREDS_ENCRYPTION_KEY =
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
      expect(() => decryptSecret(ciphertext)).toThrow();
    } finally {
      process.env.CREDS_ENCRYPTION_KEY = original;
    }
  });

  it("throws when the key is the wrong length", () => {
    const original = process.env.CREDS_ENCRYPTION_KEY;
    try {
      process.env.CREDS_ENCRYPTION_KEY = "deadbeef"; // too short
      expect(() => encryptSecret("anything")).toThrow();
    } finally {
      process.env.CREDS_ENCRYPTION_KEY = original;
    }
  });
});
