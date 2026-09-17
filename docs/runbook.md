# Deployment Runbook — Railway

Phase 13 (Deployment). This project deploys to **Railway** (managed PaaS),
configured manually through the Railway dashboard — not Railway's Config as
Code (`railway.json`/`railway.toml`, deprecated, and unavailable to any
service that has never used it before — this project's case) nor the newer
Infrastructure-as-Code TypeScript SDK (`.railway/railway.ts`, abandoned for
this project on 2026-09-16 after its CLI-version check proved broken on
Windows — see "Why no config file" below).

This document is the single source of truth for how every Railway service is
configured. If a setting in the dashboard doesn't match what's written here,
this document is stale — fix the dashboard to match here, or update here to
match a deliberate dashboard change, but don't let them silently diverge.

## Why no config file

Railway offers three ways to configure a service:

1. **Config as Code** (`railway.json`/`railway.toml`) — deprecated; per
   Railway's own docs, a service that has never used it cannot opt in as of
   2026-08-28. This project has no prior Railway deploy, so this path is
   closed.
2. **Infrastructure as Code** (`.railway/railway.ts`, the TypeScript DSL) —
   attempted first (SCRUM-125). Blocked: the published `railway` npm
   package's CLI-version check (`assertMinimumIacCliVersion` in
   `railway/dist/iac/index.js`) reads `process.env._` to find the Railway
   CLI's own executable path. `$_` is a shell convention for "last argument
   of the previous command," not a path to the calling program — verified
   directly that right after running `railway --version`, `$_` holds the
   string `"--version"`, never the CLI's path. On Windows specifically this
   check has no reliable value to read at all, so it always falls through to
   the `catch` block and reports "requires Railway CLI 5.42.1 or newer" even
   though the real installed CLI (5.57.2) is current. This is a bug in
   Railway's own package, not something fixable from this repo's config.
   Abandoned rather than worked around with a fragile shell-level hack.
3. **Dashboard configuration** (this document) — what we're using. Every
   field below is a manual setting in the Railway web UI, one time, per
   service.

## Project topology

Three Railway services in one Railway **project** (plus Railway's own
managed Postgres):

| Service | Built from | Purpose |
|---|---|---|
| `postgres` | Railway's managed Postgres plugin (not our Dockerfile) | Database |
| `app` | `docker/app.Dockerfile`, `prod` stage | Next.js web app |
| `worker` | `docker/worker.Dockerfile`, `prod` stage | node-cron scheduled jobs (daily interest, weekly binary/rank payout, monthly rank eval, nightly reconciliation) |
| `backup` | **Not yet built** — pending the backup script ticket | Scheduled `pg_dump` |

## Prerequisite: add Postgres

In the Railway dashboard, add a **Postgres** database plugin to the project
first — this gives you `DATABASE_URL` (and its component parts:
`PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`) as Railway-managed
reference variables you can pull into the `app`/`worker` services below via
Railway's variable reference syntax (`${{Postgres.DATABASE_URL}}`, or
similar — the exact reference name is shown in the dashboard once the
Postgres service exists).

**Do not connect `app`/`worker` to this default Postgres connection
directly in production** — see "Least-privilege database roles" below.
Local dev (`docker-compose.yml`) is unaffected by any of this; it keeps its
own hardcoded `postgres`/`postgres` credentials as already set up.

## Service: `app`

**Source**: this GitHub repo, branch `main`.

**Build settings** (Settings → Build):
- Builder: **Dockerfile**
- Dockerfile path: `docker/app.Dockerfile`
- Root directory: `/` (repo root — the Dockerfile's `COPY` paths assume the
  build context is the repo root, not a subdirectory)
- Build stage/target: no field for this in Railway's dashboard as far as
  confirmed — not needed anyway. `docker/app.Dockerfile`'s `prod` stage is
  deliberately the **last** stage in the file, and a plain `docker build`
  with no `--target` flag already builds the last stage by default (verified
  locally: the resulting image contains `server.js`, which only exists in
  `prod`). **First-deploy check**: after the first real Railway build,
  confirm the running process is `node server.js`, not `npm run dev` —
  if it's wrong, this default-stage assumption didn't hold on Railway's
  builder specifically and needs a different fix (e.g. splitting `prod` into
  its own Dockerfile).

**Deploy settings** (Settings → Deploy):
- Start command: leave **empty** — the Dockerfile's own `CMD ["node",
  "server.js"]` in the `prod` stage is the entrypoint. Do not override it.
- Healthcheck path: `/api/health` (already implemented,
  `src/app/api/health/route.ts` — returns `200 {"status":"ok","database":"reachable"}`
  when the DB is reachable, `503` otherwise)
- Healthcheck timeout: `30` seconds
- Restart policy: set to **"On Failure"** (or Railway's equivalent
  always-restart-on-crash option — whatever the dashboard currently calls
  it) with unlimited/high retry count. Verify this is actually enforced by
  deliberately crashing the service during the exit test (see "Exit test"
  below) rather than trusting the dashboard label alone.
- Port: `3000` (matches `EXPOSE 3000` in the Dockerfile and Next's default)
- Restart/redeploy note: Railway auto-detects `EXPOSE 3000`; if it doesn't,
  set the service's target port explicitly to `3000` in Networking settings.

**Domain**: attach a custom domain (Settings → Networking → Custom Domain)
once you have one — TLS/HTTPS is provisioned automatically by Railway for
any attached domain, no certificate management needed from us. Until a
domain is decided, Railway's own generated `*.up.railway.app` subdomain
already serves over HTTPS and is sufficient to prove the deploy works.

**Environment variables** (Settings → Variables):

| Variable | Value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | |
| `DATABASE_URL` | the `app` role's connection string (`APP_DATABASE_URL` in `.env.example`, see "Least-privilege database roles" below) | **Not** the Postgres plugin's default admin connection string |
| `MIGRATOR_DATABASE_URL` | the `migrator` role's connection string | **Required on `app` specifically** as of 2026-09-17 — `scripts/start.sh` (the image's `CMD`) runs `prisma migrate deploy`/seed with this before starting the server; see "Running migrations" below. Missing this fails the container at startup, not silently. |
| `TIMEZONE` | `Asia/Dubai` | matches `.env.example` |
| `MIN_WITHDRAWAL` | `50` | matches `.env.example` |
| `DEFAULT_DAILY_INTEREST_RATE_BP` | `0` | placeholder only, per `.env.example`'s own comment — real rate lives in versioned config tables |
| `DEFAULT_DIRECT_COMMISSION_RATE_BP` | `0` | same as above |
| `SEED_ADMIN_EMAIL` | a real production admin email, **not** `admin@investment-hub.local` | distinct per environment — see invariant on secrets below |
| `SEED_ADMIN_PASSWORD` | a real, strong, unique password | generate fresh — never reuse the dev value `invest12345` |
| `DISABLE_ADMIN_TOTP` | do not set at all | this dev-only escape hatch must not exist in production; its absence is equivalent to `false` in `auth.ts`'s check — confirm by grep before first deploy that no default silently enables it |

Do **not** set anything here by copy-pasting the real dev `.env` file — every
value above must be freshly chosen for production, per the "distinct secrets
per environment" constraint (build_plan.md Part 7, CLAUDE.md's non-negotiable
invariants).

## Service: `worker`

**Source**: same repo, branch `main`.

**Build settings**:
- Builder: **Dockerfile**
- Dockerfile path: `docker/worker.Dockerfile`
- Root directory: `/`
- Build stage: same reasoning as `app` above — `prod` is the last stage in
  `docker/worker.Dockerfile`, no target field needed. First-deploy check:
  confirm the running command is `npx tsx src/worker/index.ts`, not
  `npm run worker` from a bind-mounted dev source.

**Deploy settings**:
- Start command: leave **empty** — Dockerfile's own `CMD` handles it.
- Healthcheck path: **none available**. The worker has no HTTP server to
  probe (it's a long-lived `node-cron` process with `setInterval(() => {},
  1 << 30)` keeping it alive — see `src/worker/index.ts`). Railway's
  healthcheck field is HTTP-only; leave it unset.
- Restart policy: same "On Failure" / always-restart setting as `app`. This
  is the single most important setting for this service — the daily
  interest, weekly binary/rank payout, monthly rank evaluation, and nightly
  reconciliation jobs all depend on the worker process actually being alive
  to fire their cron triggers. The catch-up logic in each `run*CatchUp`
  function (Phase 4 onward) means a restart doesn't lose missed periods, but
  only if the process actually *does* restart.
- No port/networking config needed — this service exposes nothing.

**Environment variables**: same table as `app` above, **minus**
`MIGRATOR_DATABASE_URL` and the domain-specific concerns. The worker never
runs migrations (`docker/worker.Dockerfile`'s `CMD` starts `tsx
src/worker/index.ts` directly, no `start.sh`) and does not need DDL rights
any more than the web app's own runtime does — only `app`'s single
`DATABASE_URL` (the `app` role) is needed here.

## Least-privilege database roles

Railway's Postgres plugin gives you one connection (an admin-equivalent
role). Per this project's constraint ("app's database user has
least-privilege grants — no DROP/ALTER — separate from the migration-runner
credential"), create two roles using **`scripts/db-setup.sql`**, run in two
parts in this exact order (the ordering is required, not just tidy —
verified directly while writing the script: Postgres DDL rights are governed
by table *ownership*, and `REVOKE ... ON ledger_entries` fails outright if
that table doesn't exist yet):

1. **Before** the first `prisma migrate deploy`: run Part 1 of
   `scripts/db-setup.sql` (everything up to the `>>> Run prisma migrate
   deploy here <<<` marker) against the fresh Railway Postgres database, via
   Railway's Postgres "Connect" query console or `psql` against the
   plugin's admin connection string. Replace both placeholder passwords
   with real, freshly-generated secrets first — never reuse these across
   environments. This creates the `migrator` and `app` roles and sets up
   `ALTER DEFAULT PRIVILEGES` so `app` automatically gets
   SELECT/INSERT/UPDATE/DELETE on every table `migrator` is about to create.
2. Run `prisma migrate deploy` with `DATABASE_URL` set to the **`migrator`**
   role's connection string (`MIGRATOR_DATABASE_URL` in `.env.example`).
   This creates every table with `migrator` as owner — required for
   `migrator` to have real ALTER/DROP rights on them going forward (Postgres
   ties DDL rights to ownership, not just schema-level grants; a table
   `migrator` didn't create would NOT be alterable by it even with a broad
   schema grant — confirmed by reproducing exactly this failure while
   writing the script).
3. **After** that first migration completes: run Part 2 of
   `scripts/db-setup.sql` (`REVOKE UPDATE, DELETE ON ledger_entries FROM
   app`). This narrows `app`'s access to `ledger_entries` specifically —
   SELECT/INSERT only, matching invariant #2 ("no ledger UPDATE or DELETE")
   enforced at the database level. Every other table keeps `app`'s full
   SELECT/INSERT/UPDATE/DELETE (session logout, pending-auth consumption,
   and wallet-balance-cache updates are real production code paths that
   need this — confirmed by grep before writing the script; only
   `ledger_entries` gets the narrower grant).
4. Run the verification queries at the bottom of `scripts/db-setup.sql`
   (`\du app migrator`, plus the two `information_schema.role_table_grants`
   checks) and confirm the output matches what the script's comments say to
   expect, before pointing any real service at these roles.

After this three-step sequence:
- `app`/`worker` services' `DATABASE_URL` env var uses the **`app`** role's
  connection string (`APP_DATABASE_URL` in `.env.example` — same
  host/port/database, different user/password).
- Any future migration runs using the **`migrator`** role's connection
  string, never `app`'s.

This exact sequence (roles → migrate → ledger carve-out → verify) was
tested end-to-end against a real scratch Postgres database and a real
`prisma migrate deploy` run before being written here — not just reasoned
about. `app` was confirmed unable to `DROP`/`ALTER` any table or
`UPDATE`/`DELETE` `ledger_entries`, while retaining full CRUD on an
ordinary table (`sessions`); `migrator` was confirmed able to fully
`ALTER`/`DROP` tables it created via the migration.

## Running migrations

**Migrations now run at container startup, not as a separate pre-deploy
command** (changed 2026-09-17, SCRUM-129 follow-up). A platform-level
pre-deploy command proved unreliable to configure/debug for this project's
actual needs (the Prisma CLI's own binary/config resolution needed more
troubleshooting than that mechanism made practical), so `docker/app.Dockerfile`'s
`prod` stage now runs `scripts/start.sh` as its `CMD`, which does, in order:
1. `prisma migrate deploy`
2. `prisma/seed.ts` (idempotent — skips if a main admin already exists)
3. starts the actual server (`node server.js`)

This runs on **every** container start, including restarts and
multi-instance scale-ups — safe because `prisma migrate deploy` only
applies migrations not already recorded as applied (with Prisma's own
advisory lock preventing two concurrent instances from racing each other),
and the seed script checks for an existing main admin before doing
anything.

The `prod` stage's own `node_modules` (traced by Next's `output:
"standalone"`) does not include the Prisma CLI — only what the running Next
server needs at request time. The full Prisma CLI (with its complete,
correctly-resolved dependency tree — cherry-picking individual `node_modules`
subfolders was tried and does not work, `@prisma/config` alone pulls in
further packages like `effect` that aren't under the `prisma`/`@prisma`
scope) is copied from the `deps` build stage into a separate `/app/migrate`
path in the image, kept isolated from the server's own `node_modules` so it
never risks overwriting the real, already-generated `@prisma/client` the
server actually runs on. `tsx` (needed to run `seed.ts` directly — see
`scripts/start.sh`'s own comments for why not `prisma db seed`) and
`src/lib` (seed.ts's own imports) are copied into that same isolated path.

**The `app` service now needs BOTH env vars set**, preserving SCRUM-126's
least-privilege split rather than collapsing it:
- `DATABASE_URL` — the **`app`** role's connection string, used by the
  running server for all normal request-time queries. Never the migrator
  role.
- `MIGRATOR_DATABASE_URL` — the **`migrator`** role's connection string,
  used ONLY by `scripts/start.sh`'s migrate/seed steps, before the server
  starts. `scripts/start.sh` fails fast with a clear error if this isn't
  set, rather than silently trying to migrate with the wrong role.

Verified directly against the real dev database (`prisma migrate status`,
non-destructive, run manually inside the built image before this
start.sh-based CMD was finalized): the CLI correctly loads the schema,
connects, and reports all 40 migrations applied, confirming the underlying
command/path combination works inside the real built image.

## Structured logging

No new logging library (SCRUM-128) — `src/worker/index.ts` defines a small
`logJob(level, job, message, extra?)` helper that `JSON.stringify`s one log
object per call, printed to stdout (`level: "info"`) or stderr (`level:
"error"`). Every job-boundary log line (trigger/completed/failed) and the
five startup announcements use it. Each line has at minimum `timestamp`
(ISO 8601), `level` (`"info"` | `"error"`), `job` (the same job-type string
already used in the `job_runs` table — `daily_interest`, `binary_cycle`,
`rank_evaluation`, `rank_payout`, `reconciliation` — imported directly from
each job module's own exported constant, not re-typed, so the log output
and the `job_runs` rows can never drift apart), and `message`. A failed job
also carries `error` (the caught error's string form). Example real output
(captured by actually running the worker, not just written from memory):

```json
{"timestamp":"2026-09-16T11:38:07.815Z","level":"info","job":"worker","message":"started"}
{"timestamp":"2026-09-16T11:38:07.824Z","level":"info","job":"binary_cycle","message":"scheduled for Saturday 00:00 Asia/Dubai"}
```

Railway's log viewer can filter/search on any of these fields directly
(`job:daily_interest`, `level:error`, etc.) since each line is a complete,
independently-parseable JSON object — confirmed each emitted line parses
cleanly with `JSON.parse`. Railway captures stdout/stderr natively per
service and shows it in the dashboard's Logs tab; no third-party
error-tracking service, per the earlier decision to keep this project's
"fully internal simulation" scope free of external dependencies.

## Postgres backups

**Service**: `backup`, built from `docker/backup.Dockerfile`, running
`scripts/backup.sh`. This is a minimal Debian + `postgresql-client-16`
image (matching the real Postgres server version, 16.14) — no Node/npm at
all, independent of the `app`/`worker` images.

**What the script does** (see `scripts/backup.sh` for the full
implementation, and `docs/backup-strategy.md` for the underlying policy it
follows):
1. `pg_dump $DATABASE_URL -F c -f <timestamped file>` — custom format, per
   `docs/backup-strategy.md` section 1.
2. Immediately verifies the dump with `pg_restore -l` (a bad/unreadable
   dump is treated as a failed backup, not silently left in place as if it
   succeeded).
3. Applies the retention policy from `docs/backup-strategy.md` section 2
   (age-tier based: keep every daily backup for 7 days, one per week for
   8–30 days old, one per month for 31–90 days old, delete beyond 90 days
   — always keeping the *oldest* backup when collapsing a tier). This was
   tested directly against fabricated files at every tier boundary (ages
   6/7/8, 29/30/31, 89/90/91 days) before being trusted, not just read
   through — all boundaries landed on the correct side of
   `docs/backup-strategy.md`'s stated ranges.
4. Leaves a clearly marked `TODO` for the off-box sync step — **not yet
   decided** (per the open question in `tasks/todo.md`: S3-compatible
   bucket vs. remote host over SSH/rsync). Until that's chosen, backups
   only protect against data corruption (bad migration, bug, accidental
   deletion), not host/volume loss — see `docs/backup-strategy.md` section 4.

**Database role**: reuses the **`app`** role's connection string
(`APP_DATABASE_URL`) — decided deliberately over provisioning a fourth
credential, since `app` already has SELECT on every table (sufficient for
a full logical dump — `pg_dump` only ever issues read queries, regardless
of what other privileges the connecting role holds) and zero DDL rights.
Not a dedicated read-only role; revisit if this project's security posture
ever needs backups to be impossible to run from a role that can also write.

**Railway dashboard configuration**:
- Build settings: Builder **Dockerfile**, Dockerfile path
  `docker/backup.Dockerfile`, root directory `/`.
- **Schedule**: Railway supports cron-scheduled services — set the
  recurring trigger via the dashboard's own cron/schedule control for this
  service (Settings → the cron/schedule section; the exact control name
  wasn't confirmed in Railway's published IaC docs, per the SCRUM-125
  findings, but the dashboard itself does expose a scheduling UI for a
  service — set it here rather than in any config file). Recommended:
  once daily, at a time offset from the worker's own midnight-boundary jobs
  (e.g. `30 0 * * *` UTC, after the 00:20 Asia/Dubai reconciliation job has
  had time to complete) so the backup captures a day whose books are
  already reconciled, not a half-processed one.
- **Volume mount**: attach a Railway volume mounted at `/backups` (matches
  `scripts/backup.sh`'s default `$BACKUP_DIR`) so backups persist across
  the cron service's runs — a cron service's filesystem is not guaranteed
  to persist between invocations without an explicit volume.
- **Environment variables**:

  | Variable | Value | Notes |
  |---|---|---|
  | `DATABASE_URL` | the `app` role's connection string (`APP_DATABASE_URL`) | same value as the `app`/`worker` services |
  | `BACKUP_DIR` | `/backups` | only needed if the volume is mounted somewhere other than the script's default |

**First-run verification**: after the first scheduled (or manually
triggered) run, confirm a `.dump` file actually landed in the mounted
volume, then run `pg_restore -l` against it from a separate shell (or
re-verify via a manual `railway run --service backup -- pg_restore -l
/backups/investment_hub_<timestamp>.dump`) as independent proof the file is
restorable — the same "actually rehearse it, don't just document it"
standard the exit test applies to a full restore.

## Rollback

Railway keeps deploy history per service (Deployments tab). To roll back:
1. Open the `app` (or `worker`) service's Deployments tab.
2. Find the last known-good deployment.
3. Use Railway's "Redeploy" / "Rollback to this deployment" action.
4. **If the bad deploy included a forward-only migration**, a rollback of
   the app code does NOT undo the migration — per this project's own
   append-only-ledger and no-destructive-migration conventions, a schema
   rollback is not something to script casually. Assess whether the new
   schema is backward-compatible with the old code before rolling back code
   alone; if not, this needs a hand-written forward-fix migration, not a
   database rollback.

## Re-triggering a missed scheduled job safely

Every job in `src/worker/index.ts` (`runDailyInterestCatchUp`,
`runBinaryCycleCatchUp`, `runRankEvaluationCatchUp`, `runRankPayoutCatchUp`,
`runReconciliationCatchUp`) is idempotent and catch-up-aware by design
(Phase 4 onward) — each writes a `job_runs` row keyed by `(job_type,
period_key)` under a `UNIQUE` constraint, so calling the same catch-up
function again for a period that already completed is a safe no-op, not a
double-payout.

To manually re-trigger after a confirmed missed period (e.g. the worker was
down for an extended window and you don't want to wait for its next natural
cron tick):

```
railway run --service worker -- npx tsx -e "
  import('./src/lib/daily-interest-job.js').then(m => m.runDailyInterestCatchUp(new Date()));
"
```

(substitute the relevant `run*CatchUp` function/module for whichever job was
missed). This is safe to run repeatedly — the idempotency key means it will
only ever process genuinely-missing periods, never reprocess a completed
one. Always verify with `runReconciliation()` (or the nightly reconciliation
job's own log output) after any manual catch-up trigger, per this project's
standing "recompute from source, then verify with reconciliation, not a
manual balance check" repair principle.

## Exit test (to run once services are configured)

Run this against the real Railway deployment and record the actual output —
per this project's standing rule, an exit test isn't complete until it's
actually been run and the result shown, not just described as passing:

1. **HTTPS reachable**: `curl -I https://<your-app-domain>/api/health` →
   expect `HTTP/2 200` and a valid, non-self-signed certificate (verify via
   browser padlock or `openssl s_client -connect <domain>:443 -servername <domain> </dev/null 2>/dev/null | openssl x509 -noout -issuer`).
2. **Worker running + first scheduled job processed**: check the `worker`
   service's logs for the five `"[worker] ... job scheduled for ..."` startup
   lines, then wait for (or manually trigger, per above) one real job run and
   confirm its `"...completed"` log line plus a real `job_runs` row via the
   Postgres console.
3. **DB reachable via least-privilege role**: confirm `/api/health` reports
   `"database": "reachable"` (this uses the `app` role's `DATABASE_URL`), and
   separately confirm the `app` role genuinely cannot `DROP TABLE` or `ALTER
   TABLE` anything (attempt one by hand via `psql` as `app` and confirm it's
   refused with a permissions error).
4. **Backup taken + restore rehearsed**: pending the backup service's
   implementation (see above) — cannot be completed until that exists.
5. **Worker auto-restart**: from the Railway dashboard or CLI, forcibly stop
   the `worker` service's running process (not a graceful redeploy — an
   actual crash/kill) and confirm Railway brings it back up on its own,
   observed via the Deployments/Logs tab showing a new restart event with no
   manual intervention.
6. **Catch-up credits a missed day correctly**: after the restart in step 5,
   deliberately verify (via the Postgres console) that no calendar day's
   `job_runs` row for `daily_interest` is missing between the last completed
   period before the kill and today — the catch-up logic should have filled
   any gap automatically on the worker's next successful tick after restart.

This section stays a checklist, not a "done," until each of the six items
above has actually been executed against the real deployment with real
output recorded.
