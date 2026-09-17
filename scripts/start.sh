#!/bin/sh
# Production container entrypoint (SCRUM-129 follow-up). Runs migration +
# seed directly ahead of starting the server, on every container start
# (including restarts and multi-instance scale-ups) — safe because:
#   - `prisma migrate deploy` is idempotent: it only applies migrations not
#     already recorded as applied, and Prisma takes an advisory lock so
#     concurrent invocations (e.g. two instances starting at once) don't
#     race each other.
#   - prisma/seed.ts is itself idempotent: it checks for an existing
#     `isMainAdmin: true` user first and skips entirely if one exists (see
#     that file) — it does not recreate/reset the admin account on every
#     boot.
#
# Seed runs via `tsx prisma/seed.ts` directly, NOT `prisma db seed` —
# `prisma db seed` shells out through `package.json#prisma.seed`, which
# requires a `package.json` to exist in a location Prisma's config
# resolution can find plus the invoked command's own environment; the
# isolated /app/migrate directory (deliberately separate from the server's
# own node_modules, see docker/app.Dockerfile's comments) has no
# package.json. Invoking tsx directly on the same script file sidesteps
# that resolution entirely and is a documented equivalent (`prisma.seed`
# in package.json is defined as exactly this command).
#
# Migrate/seed run under MIGRATOR_DATABASE_URL, not the app's own
# DATABASE_URL, per SCRUM-126's least-privilege split — the `app` role has
# no CREATE/DROP/ALTER and cannot run migrations; only `migrator` can.
# Moving migrations into this same container's startup does NOT collapse
# that boundary: DATABASE_URL (used by the server itself, further below)
# stays on the `app` role at all times; MIGRATOR_DATABASE_URL is used only
# for these two commands, in this one process, before the server starts.
if [ -z "$MIGRATOR_DATABASE_URL" ]; then
  echo "[start] FATAL: MIGRATOR_DATABASE_URL is not set — required to run migrations at startup" >&2
  exit 1
fi

set -e

echo "[start] running prisma migrate deploy"
cd /app/migrate
DATABASE_URL="$MIGRATOR_DATABASE_URL" ./node_modules/.bin/prisma migrate deploy --schema=/app/prisma/schema.prisma
echo "[start] migrate deploy completed"

echo "[start] running seed"
DATABASE_URL="$MIGRATOR_DATABASE_URL" ./node_modules/.bin/tsx prisma/seed.ts
echo "[start] seed completed"

cd /app
echo "[start] starting server"
exec node server.js
