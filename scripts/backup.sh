#!/usr/bin/env bash
# Postgres backup script (Phase 13 / SCRUM-127).
#
# Takes one pg_dump (custom format, per docs/backup-strategy.md section 1),
# writes it to a timestamped file under $BACKUP_DIR, then applies the
# retention policy from docs/backup-strategy.md section 2 to everything
# already in that directory. Intended to run once per day as a Railway
# Cron Service (docker/backup.Dockerfile) — see docs/runbook.md's "Backup
# service" section for the schedule/mount configuration.
#
# This script is the automation docs/backup-strategy.md explicitly says it
# does NOT provide ("Out of scope here, owned by Phase 13") — it follows
# that document's own commands and policy rather than inventing a new one;
# see SCRUM-127's own confirmation that the fixed-count "7/4/3" description
# in the ticket was a paraphrase and docs/backup-strategy.md's age-tier
# policy is the real source of truth.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB_NAME="${PGDATABASE:-investment_hub}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[backup] FATAL: DATABASE_URL is not set" >&2
  exit 1
fi

# Strip the Prisma-only `schema` query parameter (e.g. `?schema=public`, as
# used throughout this project's .env/.env.example) before handing the URL
# to pg_dump, while preserving every OTHER query parameter (sslmode, etc.)
# in case a real Railway connection string needs one. Confirmed directly:
# `pg_dump` fails outright with `invalid URI query parameter: "schema"` —
# libpq's connection-string parser has no concept of Prisma's `schema`
# param (a Prisma Client convention, not a real libpq/psql option).
# Handles `schema` appearing first, in the middle, or as the only param.
PG_DUMP_URL="$(printf '%s' "$DATABASE_URL" | sed -E 's/([?&])schema=[^&]*&/\1/; s/[?&]schema=[^&]*$//; s/\?$//')"
if [ "$PG_DUMP_URL" != "$DATABASE_URL" ]; then
  echo "[backup] stripped Prisma-only schema= query parameter for pg_dump"
fi

mkdir -p "$BACKUP_DIR"

# ============================================================
# 1. Take the backup
# ============================================================

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DUMP_FILE="$BACKUP_DIR/investment_hub_${TIMESTAMP}.dump"

echo "[backup] starting pg_dump -> $DUMP_FILE"

# -F c: custom format, per docs/backup-strategy.md section 1 — compressed,
# and the only format pg_restore can selectively restore from. DATABASE_URL
# here is expected to be the `app` role's connection string (SELECT-only
# reach on every table plus INSERT/UPDATE/DELETE it doesn't need for a
# backup, but no DDL rights) — confirmed sufficient for a full logical dump
# since pg_dump only ever issues read queries against the target database,
# regardless of what other privileges the connecting role happens to hold.
pg_dump "$PG_DUMP_URL" -F c -f "$DUMP_FILE"

echo "[backup] pg_dump completed"

# ============================================================
# 2. Verify the dump immediately, per docs/backup-strategy.md's own rule:
#    "a backup file that can't be read isn't a backup... do not discover a
#    bad backup only when an actual restore is needed."
# ============================================================

if ! pg_restore -l "$DUMP_FILE" >/dev/null 2>&1; then
  echo "[backup] FATAL: pg_restore -l could not read $DUMP_FILE — the dump is unusable, leaving it in place for inspection but not counting it as a successful backup" >&2
  exit 1
fi

echo "[backup] verified: $DUMP_FILE is a structurally sound dump"

# ============================================================
# 3. Off-box sync — TODO, not yet decided.
#
# docs/backup-strategy.md section 4 is explicit that a backup living only
# on the same host as the live database protects against data corruption
# (bad migration, bug, accidental deletion) but NOT against host loss (disk
# failure, the whole machine disappearing). Until an off-box destination is
# chosen (S3-compatible bucket, another host over SSH/rsync, etc. — see
# tasks/todo.md's open question), this script only writes to $BACKUP_DIR,
# which on Railway should be a mounted volume (survives service restarts,
# per docs/runbook.md) but does NOT survive the volume itself being lost.
#
# TODO(SCRUM-127-followup): once a destination is decided, add the actual
# upload/sync command here, immediately after the verification step above
# and before retention pruning — sync the file that was just verified good,
# not a file retention might delete moments later.
# ============================================================

# ============================================================
# 4. Apply retention policy (docs/backup-strategy.md section 2):
#      - last 7 days: keep every daily backup
#      - 8-30 days old: keep one backup per week
#      - 31-90 days old: keep one backup per month
#      - older than 90 days: delete
#    Per that document's explicit rule: when collapsing a tier down to
#    "one per week"/"one per month", always keep the OLDEST backup in that
#    tier, so the retained backup's age is predictable.
# ============================================================

echo "[backup] applying retention policy to $BACKUP_DIR"

NOW_EPOCH="$(date -u +%s)"
DAY_SECONDS=86400

# List every backup file, oldest first, as "<epoch_seconds> <path>" pairs.
# Filenames are investment_hub_YYYYMMDDTHHMMSSZ.dump (UTC, per section 1),
# so the timestamp is parsed directly from the filename rather than trusting
# filesystem mtimes (which a copy/restore operation could alter).
mapfile -t BACKUP_ENTRIES < <(
  for f in "$BACKUP_DIR"/investment_hub_*.dump; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    ts="${base#investment_hub_}"
    ts="${ts%.dump}"
    # ts is YYYYMMDDTHHMMSSZ — reformat to something `date -d`/`date -j` can parse.
    if [[ "$ts" =~ ^([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})Z$ ]]; then
      iso="${BASH_REMATCH[1]}-${BASH_REMATCH[2]}-${BASH_REMATCH[3]}T${BASH_REMATCH[4]}:${BASH_REMATCH[5]}:${BASH_REMATCH[6]}Z"
      epoch="$(date -u -d "$iso" +%s 2>/dev/null || date -u -j -f "%Y-%m-%dT%H:%M:%SZ" "$iso" +%s 2>/dev/null || true)"
      if [ -n "$epoch" ]; then
        echo "$epoch $f"
      else
        echo "[backup] WARNING: could not parse timestamp from $base, skipping in retention pass" >&2
      fi
    else
      echo "[backup] WARNING: $base does not match the expected filename pattern, skipping in retention pass" >&2
    fi
  done | sort -n
)

declare -A WEEK_KEPT
declare -A MONTH_KEPT
DELETED_COUNT=0
KEPT_COUNT=0

for entry in "${BACKUP_ENTRIES[@]}"; do
  epoch="${entry%% *}"
  path="${entry#* }"
  age_days=$(( (NOW_EPOCH - epoch) / DAY_SECONDS ))

  if [ "$age_days" -lt 7 ]; then
    # Last 7 days: keep everything.
    KEPT_COUNT=$((KEPT_COUNT + 1))
    continue
  fi

  if [ "$age_days" -gt 90 ]; then
    echo "[backup] deleting (older than 90 days, age=${age_days}d): $path"
    rm -f "$path"
    DELETED_COUNT=$((DELETED_COUNT + 1))
    continue
  fi

  if [ "$age_days" -le 30 ]; then
    # 8-30 days old: one per week. Bucket key = ISO week number computed
    # from the file's own embedded UTC date, so the bucketing is stable
    # regardless of what day this script happens to run on.
    week_key="$(date -u -d "@$epoch" +%G-W%V 2>/dev/null || date -u -j -f "%s" "$epoch" +%G-W%V 2>/dev/null)"
    if [ -z "${WEEK_KEPT[$week_key]:-}" ]; then
      # First (= oldest, since the list is sorted ascending) backup seen
      # for this week — keep it, per the "keep the oldest in a collapsed
      # tier" rule.
      WEEK_KEPT["$week_key"]=1
      KEPT_COUNT=$((KEPT_COUNT + 1))
    else
      echo "[backup] deleting (redundant within week $week_key, age=${age_days}d): $path"
      rm -f "$path"
      DELETED_COUNT=$((DELETED_COUNT + 1))
    fi
    continue
  fi

  # 31-90 days old: one per month, same "keep the oldest" rule.
  month_key="$(date -u -d "@$epoch" +%Y-%m 2>/dev/null || date -u -j -f "%s" "$epoch" +%Y-%m 2>/dev/null)"
  if [ -z "${MONTH_KEPT[$month_key]:-}" ]; then
    MONTH_KEPT["$month_key"]=1
    KEPT_COUNT=$((KEPT_COUNT + 1))
  else
    echo "[backup] deleting (redundant within month $month_key, age=${age_days}d): $path"
    rm -f "$path"
    DELETED_COUNT=$((DELETED_COUNT + 1))
  fi
done

echo "[backup] retention pass complete: kept $KEPT_COUNT, deleted $DELETED_COUNT"
echo "[backup] done"
