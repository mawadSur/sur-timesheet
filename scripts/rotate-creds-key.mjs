#!/usr/bin/env node
// scripts/rotate-creds-key.mjs
//
// Re-encrypt every row in `public.credentials` from OLD_KEY to NEW_KEY.
// Runbook: docs/CREDS_ROTATION.md
//
// This is an OUT-OF-BAND operational script — run it from a trusted machine, not
// from the app. Bulk read/write of the vault requires the SERVICE ROLE key,
// because anon RLS restricts `credentials` to admins / assigned users only. The
// app itself has no service-role client on purpose; keep it that way.
//
// Safety guarantees:
//   • It never prints plaintext secrets (only ids / labels / counts).
//   • It decrypts + re-encrypts EVERYTHING in memory first and aborts on any
//     genuine decrypt error, so it never leaves the table half-rotated.
//   • --dry-run reports counts and writes nothing.
//   • Re-running after an interrupted run is safe: rows already under NEW_KEY are
//     detected and skipped.
//
// AES-256-GCM ciphertext layout (base64): [ iv(12) | authTag(16) | ciphertext ].
// This mirrors lib/crypto.ts exactly — if that layout ever changes, change it
// here too.
//
// Usage:
//   OLD_KEY=... NEW_KEY=... \
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/rotate-creds-key.mjs [--dry-run]
//
//   # keys may also be passed as flags (visible in `ps`/shell history — prefer env):
//   node scripts/rotate-creds-key.mjs --old-key <k> --new-key <k> --dry-run

import crypto from "node:crypto";
import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const PAGE = 1000;

// ── AES-256-GCM helpers (mirror of lib/crypto.ts) ────────────────────────────
function parseKey(raw, label) {
  if (!raw) throw new Error(`${label} is empty`);
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(`${label} must decode to 32 bytes (64 hex chars or base64)`);
  }
  return key;
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

function decrypt(payload, key) {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

// ── args + env ───────────────────────────────────────────────────────────────
function getArg(flag) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`${flag}=`));
  return eq ? eq.slice(flag.length + 1) : undefined;
}

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const oldRaw = getArg("--old-key") ?? process.env.OLD_KEY;
const newRaw = getArg("--new-key") ?? process.env.NEW_KEY;
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!oldRaw || !newRaw) {
  die(
    "Missing keys. Provide OLD_KEY and NEW_KEY via env or --old-key/--new-key.\n" +
      "  Usage: node scripts/rotate-creds-key.mjs [--dry-run]"
  );
}
if (!supabaseUrl) die("Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL).");
if (!serviceKey) {
  die(
    "Missing SUPABASE_SERVICE_ROLE_KEY. Bulk vault access needs the service role " +
      "(anon RLS blocks it). Never expose this key to the app or a client."
  );
}

let oldKey, newKey;
try {
  oldKey = parseKey(oldRaw, "OLD_KEY");
  newKey = parseKey(newRaw, "NEW_KEY");
} catch (e) {
  die(e.message);
}

if (oldKey.equals(newKey)) {
  console.warn(
    "⚠ OLD_KEY and NEW_KEY are identical — nothing meaningful to rotate."
  );
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function fetchAllRows() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("credentials")
      .select("id, label, secret_encrypted")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) die(`Failed to read credentials: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function main() {
  console.log(
    `\n\u{1f511} Credentials key rotation${DRY_RUN ? " (DRY RUN — no writes)" : ""}`
  );
  console.log(`   Supabase: ${supabaseUrl}`);

  const rows = await fetchAllRows();
  console.log(`   Rows in credentials: ${rows.length}`);
  if (rows.length === 0) {
    console.log("   Nothing to do.\n");
    return;
  }

  // Pass 1: decrypt + re-encrypt everything IN MEMORY first. Abort on any genuine
  // decrypt failure so we never leave the table half-rotated.
  const plan = [];
  let alreadyRotated = 0;
  for (const row of rows) {
    try {
      const plain = decrypt(row.secret_encrypted, oldKey);
      plan.push({ id: row.id, secret_encrypted: encrypt(plain, newKey) });
    } catch {
      // Maybe a previous, interrupted run already rotated this row: verify it
      // decrypts cleanly under NEW_KEY before deciding it's fine to skip.
      try {
        decrypt(row.secret_encrypted, newKey);
        alreadyRotated++;
      } catch {
        die(
          `Could not decrypt credential ${row.id} (label: ${row.label}) with ` +
            `OLD_KEY or NEW_KEY. Aborting BEFORE any writes — no rows changed. ` +
            `Check that OLD_KEY matches the key these rows were encrypted with.`
        );
      }
    }
  }

  console.log(`   Re-encryptable rows: ${plan.length}`);
  if (alreadyRotated) {
    console.log(`   Already under NEW_KEY (skipped): ${alreadyRotated}`);
  }

  if (DRY_RUN) {
    console.log(
      `\n✔ Dry run OK. ${plan.length} row(s) would be re-encrypted, ` +
        `${alreadyRotated} already rotated. No changes written.\n`
    );
    return;
  }

  // Pass 2: write. Only rows that were successfully re-encrypted above.
  let updated = 0;
  for (const item of plan) {
    const { error } = await supabase
      .from("credentials")
      .update({ secret_encrypted: item.secret_encrypted })
      .eq("id", item.id);
    if (error) {
      die(
        `Update failed on credential ${item.id} after ${updated} successful ` +
          `write(s). Table is PARTIALLY rotated. Re-run with the SAME OLD_KEY/` +
          `NEW_KEY to finish — already-rotated rows are detected and skipped. ` +
          `Error: ${error.message}`
      );
    }
    updated++;
  }

  console.log(`\n✔ Rotated ${updated} credential(s) to NEW_KEY.`);
  console.log(
    "   Next: set CREDS_ENCRYPTION_KEY to the NEW key on Vercel (all envs) + " +
      ".env.local, redeploy, then verify a reveal. See docs/CREDS_ROTATION.md.\n"
  );
}

main().catch((e) => die(e?.message ?? String(e)));
