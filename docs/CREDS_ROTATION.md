# Credentials Encryption Key Rotation

The credentials vault stores every secret as AES-256-GCM ciphertext, encrypted
with a single key: **`CREDS_ENCRYPTION_KEY`**. Rotating that key means
re-encrypting every row in `public.credentials` from the OLD key to a NEW key,
then swapping the env var so the app decrypts with the NEW key.

`scripts/rotate-creds-key.mjs` does the re-encryption. It is an **out-of-band**
operational script — run it from a trusted machine, **never from the app**.

## Why the service role is required

The rotation reads and rewrites every ciphertext row. Anon RLS restricts
`credentials` to admins and assigned users, so a bulk read/update needs the
**service-role key** (`SUPABASE_SERVICE_ROLE_KEY`, from Supabase project
settings → API). The app has no service-role client on purpose — this key lives
only in your terminal for the duration of the rotation and must never be shipped
to the app, the client, or git.

## Prerequisites

- Node 18+ and the repo's dependencies installed (`npm install`).
- The **current** key (OLD_KEY) — the value currently in `CREDS_ENCRYPTION_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` for the project.
- Do it during a quiet window: there is a brief gap (step 4 → 5) where rows are
  encrypted under NEW but the app still holds OLD, so reveals fail until the env
  swap + redeploy lands. Keep OLD_KEY handy so you can roll back.

## Step 1 — Generate a new key

A 32-byte key as 64 hex chars:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or: openssl rand -hex 32
```

Save it somewhere safe as `NEW_KEY`. Do not commit it.

## Step 2 — Dry run (writes nothing)

Confirms every row decrypts under OLD_KEY and counts what would change. Nothing
is written.

```bash
OLD_KEY=<current key> \
NEW_KEY=<new key> \
NEXT_PUBLIC_SUPABASE_URL=<project url> \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
node scripts/rotate-creds-key.mjs --dry-run
```

If any row cannot be decrypted with OLD_KEY, the script aborts and writes
nothing — fix OLD_KEY (it must match the key those rows were encrypted with)
before continuing. The script never prints plaintext secrets.

> Keys can also be passed as `--old-key <k> --new-key <k>`, but flags are visible
> in `ps` and shell history — prefer env vars. If you keep the values in a local
> env file, you can source them with Node's built-in loader:
> `node --env-file=.env.rotation scripts/rotate-creds-key.mjs --dry-run`.

## Step 3 — Run for real

Same command, drop `--dry-run`:

```bash
OLD_KEY=<current key> \
NEW_KEY=<new key> \
NEXT_PUBLIC_SUPABASE_URL=<project url> \
SUPABASE_SERVICE_ROLE_KEY=<service role key> \
node scripts/rotate-creds-key.mjs
```

The script decrypts + re-encrypts every row in memory first and aborts before
writing if any row fails, so the table is never left half-rotated. On success it
prints how many rows it rotated.

## Step 4 — Swap the app key (do this immediately after step 3)

The rows are now encrypted under NEW, but the app still has OLD — reveals will
fail until you swap. Set the new value everywhere the old one lived:

- **Vercel** → project `sur-timesheet` → Settings → Environment Variables →
  set `CREDS_ENCRYPTION_KEY` to the NEW key for **all environments**
  (Production, Preview, Development), then **redeploy** so it takes effect.
- **`.env.local`** — update `CREDS_ENCRYPTION_KEY` to the NEW key for local dev.

## Step 5 — Verify a reveal

Open the app (Production once redeployed, or local dev) as an admin or an
assigned user and reveal a credential for a project that has entries. If the
plaintext shows correctly, rotation is complete. (Each reveal is audit-logged as
usual.)

## Rollback

If verification fails and you still have both keys, re-run the script with the
keys swapped to put ciphertext back under the OLD key, then revert
`CREDS_ENCRYPTION_KEY`:

```bash
OLD_KEY=<new key> NEW_KEY=<old key> ... node scripts/rotate-creds-key.mjs
```

If step 3 was interrupted (partial write), just re-run it with the **same**
OLD_KEY/NEW_KEY — rows already under NEW_KEY are detected and skipped, so it
finishes cleanly.

## After you're done

Destroy the local copies of the service-role key and the OLD key once you're
confident the NEW key works (keep OLD only as long as you might need to roll
back). Never commit any of these values.
