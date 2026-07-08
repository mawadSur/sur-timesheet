#!/usr/bin/env bash
#
# backup-db.sh — belt-and-suspenders logical backup of the Sur Portal Postgres DB.
#
# This is the OPTIONAL secondary backup. The PRIMARY mechanism is Supabase's
# managed daily backups + Point-in-Time Recovery (see docs/BACKUPS.md). This
# script just takes a self-contained `pg_dump` snapshot of the application data
# so we always have an off-Supabase copy we can restore or migrate elsewhere.
#
# What it does:
#   1. Reads the DB connection string from $SUPABASE_DB_URL (never hardcoded).
#   2. Writes a timestamped, compressed custom-format dump into $BACKUP_DIR.
#   3. Prunes dumps older than $RETENTION_DAYS.
#
# Usage:
#   export SUPABASE_DB_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres'
#   ./scripts/backup-db.sh
#
# Optional overrides (all have sane defaults):
#   BACKUP_DIR       where dumps are written        (default: <repo>/backups)
#   RETENTION_DAYS   prune dumps older than N days   (default: 30)
#   DUMP_SCHEMA      schema to dump                   (default: public)
#
# Requirements: pg_dump (from the postgresql-client package), matching the
# server's major version or newer. Do NOT run this against production without
# a read-only / low-traffic window in mind — pg_dump takes a consistent
# snapshot but does hold a transaction open for its duration.
#
# Safety: fail fast, treat unset vars as errors, and fail on any pipe stage.
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────

# Connection string is a secret; it MUST come from the environment.
if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "error: SUPABASE_DB_URL is not set." >&2
  echo "       Get it from Supabase → Project Settings → Database → Connection string" >&2
  echo "       (URI). Then: export SUPABASE_DB_URL='postgresql://...'" >&2
  exit 1
fi

# Resolve the repo root from this script's location so the default backups dir
# is stable no matter where the script is invoked from.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd -P)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." >/dev/null 2>&1 && pwd -P)"

BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
DUMP_SCHEMA="${DUMP_SCHEMA:-public}"

# Validate RETENTION_DAYS is a non-negative integer so the prune step is safe.
if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  echo "error: RETENTION_DAYS must be a non-negative integer (got '${RETENTION_DAYS}')." >&2
  exit 1
fi

# ── Preflight ────────────────────────────────────────────────────────────────

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "error: pg_dump not found. Install the postgresql-client package." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

TIMESTAMP="$(date -u +%Y%m%d-%H%M%S)"
DUMP_FILE="${BACKUP_DIR}/sur-portal-${TIMESTAMP}.dump"

# ── Dump ─────────────────────────────────────────────────────────────────────
#
# --format=custom   compressed, restored with pg_restore (selective, parallel).
# --no-owner        drop ownership so it restores cleanly into another project
# --no-privileges   drop GRANTs for the same reason (RLS policies are still
#                   dumped as part of the schema; roles differ across projects).
# --schema          only our application schema; Supabase-managed schemas
#                   (auth, storage, ...) are covered by managed backups / PITR.
#
# NOTE: the credentials table is included, so the dump CONTAINS the AES-256-GCM
# *ciphertext* of vault secrets — but NOT the CREDS_ENCRYPTION_KEY, which lives
# only in Vercel/.env.local. A dump is useless without that key; back the key up
# separately (see docs/BACKUPS.md) and treat these dump files as sensitive.

echo "Backing up schema '${DUMP_SCHEMA}' → ${DUMP_FILE}"

# Write to a .partial file first, then atomically rename on success, so a failed
# or interrupted run never leaves a truncated dump that the prune step keeps.
TMP_FILE="${DUMP_FILE}.partial"
trap 'rm -f "${TMP_FILE}"' EXIT

pg_dump \
  --dbname="${SUPABASE_DB_URL}" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema="${DUMP_SCHEMA}" \
  --file="${TMP_FILE}"

mv -f "${TMP_FILE}" "${DUMP_FILE}"
trap - EXIT

DUMP_SIZE="$(du -h "${DUMP_FILE}" | cut -f1)"
echo "Backup complete: ${DUMP_FILE} (${DUMP_SIZE})"

# ── Prune old dumps ──────────────────────────────────────────────────────────
#
# -mtime +N matches files last modified strictly more than N*24h ago, so this
# keeps roughly the last RETENTION_DAYS days of dumps and deletes the rest.
# Scoped to this script's own naming pattern so nothing else is ever touched.

echo "Pruning dumps older than ${RETENTION_DAYS} days in ${BACKUP_DIR}"
find "${BACKUP_DIR}" \
  -maxdepth 1 \
  -type f \
  -name 'sur-portal-*.dump' \
  -mtime +"${RETENTION_DAYS}" \
  -print \
  -delete

echo "Done."
