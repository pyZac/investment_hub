# Phase 13 — Deployment: Session Todo

Prerequisite check: Phases 0–12 complete, exit tests passed (confirmed by user). ✅

Pre-flight (done before this checklist was written):
- [x] Reverted `DISABLE_ADMIN_TOTP=false` in `.env` (was `true`) — confirmed by direct read.
- [x] Read `/docs/phases/phase-13-deployment.md` in full.
- [x] Read `/tasks/lessons.md` in full.
- [x] Read `/docs/build_plan.md` Phase 13 section + Part 7 (Transport & Headers / Secrets subsections).
- [x] Confirmed `vitest.config.ts` already force-sets `DISABLE_ADMIN_TOTP: "false"` regardless of `.env` (2026-09-12 lesson — no action needed, just verified still in place).

## Target platform: Railway

Confirmed with you — this is a managed PaaS deploy (app + worker + postgres as
separate Railway services), not a bare VPS. This reshapes several deliverables
from the phase brief's literal wording, resolved as follows:

| Brief's literal ask | Resolution for Railway |
|---|---|
| Nginx/Caddy reverse proxy + TLS/HSTS | **Dropped as a separate service.** Railway terminates TLS itself at its edge for any custom domain (auto-provisioned cert, no certbot/ACME config needed from us). We still add HSTS + the other security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) via Next.js middleware — that part isn't proxy-dependent and Phase 12 may have already added some of these (needs checking, not re-adding blindly). Runbook documents that TLS termination is Railway-managed. |
| Postgres backups: `pg_dump` on cron | **Railway Cron Service** (a separate Railway service on a cron schedule) running `pg_dump` against the Postgres service's connection string, writing to a mounted volume. Off-box sync destination is not yet decided (per your answer) — implemented as a clearly-marked TODO step in the backup script/runbook, not silently skipped. |
| Worker supervised & auto-restarting | Railway restarts a crashed service automatically by default (platform-level), on top of the catch-up logic already built in Phase 4. Verify Railway's actual restart-policy config surface and set it explicitly rather than assuming the default is sufficient. |
| DB least-privilege app role separate from migration-runner | Railway provisions its own Postgres with one default connection/credential. We run a **one-time SQL setup script** (hand-written, tagged-template-safe per invariant #10) creating `app` (least privilege, no DROP/ALTER/CREATE) and `migrator` roles, then point the running app/worker's `DATABASE_URL` at `app` and the migration step at `migrator`. Documented as a manual one-time step in the runbook, since Railway's dashboard only exposes the original role's connection string. |
| TLS cert source | Real domain + Let's Encrypt — but this is Railway's job, not ours, once a custom domain is attached in the Railway dashboard and DNS is pointed at it. Need the actual domain name from you when we get to that step. |
| Error tracking | Structured JSON logs to stdout only, no external service (per your answer) — Railway captures service logs natively, no new dependency needed. |

## Scope for this phase (6 deliverables from the brief, reinterpreted above)

1. ~~Docker Compose production profile~~ → **Railway service definitions**
   (`railway.json`/`railway.toml` or per-service Railway config) for
   `app`, `worker`, `postgres`, `backup` (cron service) — Docker Compose
   itself was for local dev; Railway builds from the existing Dockerfiles
   directly, but those Dockerfiles currently only have a `dev` target
   (bind-mount source, `npm run dev`) — **need a real production build
   target added to both `app.Dockerfile` and `worker.Dockerfile`**
   (`npm run build` + `npm run start` / `npm run worker`, no dev bind
   -mounts, no dev-only deps in the final layer).
2. Security headers (HSTS + CSP + X-Frame-Options + X-Content-Type-Options
   + Referrer-Policy) via Next.js middleware — audit what Phase 12 already
   added before writing anything new.
3. Postgres backup: `pg_dump` via Railway Cron Service → local/mounted
   path, off-box sync left as an explicit documented TODO.
4. Worker restart policy explicitly configured on Railway (not just
   assumed default) + catch-up logic already exists (Phase 4) — exit test
   proves both halves together.
5. Structured JSON logging (stdout) — audit existing `console.log`/
   `console.error` calls in `src/worker/index.ts` and elsewhere; decide
   whether a minimal structured-log wrapper is needed or plain JSON.stringify
   at call sites is sufficient (avoid pulling in a new logging library for
   a simulation project unless it earns its keep).
6. Deployment runbook: deploy, rollback, restore-from-backup, safely
   re-trigger a missed job — Railway-specific steps (not generic VPS ones).

Constraints carried over unchanged: per-environment secrets (Railway env
vars per-service/per-environment, never reused), least-privilege DB roles
(above), `.env` never committed, `.env.example` stays value-free.

## Still need from you before implementing

- [ ] **Domain name** for the custom domain to attach in Railway (needed for
      the real-TLS exit test step — "app reachable over HTTPS with valid
      TLS"). Can be provided later, once we reach that step, if not decided
      yet.
- [ ] **Railway CLI access**: do you have the Railway CLI installed and
      authenticated already, or do you want me to give you exact commands to
      run yourself (since actually creating/provisioning Railway
      services/projects is an external, billed, account-linked action —
      I should not attempt this autonomously without your go-ahead per the
      "hard-to-reverse / affects shared systems" guidance).

## Implementation checklist (pending your final confirmation to start)

- [x] **SCRUM-124 — done.** Added `builder`+`prod` multi-stage targets to
      `docker/app.Dockerfile`: `builder` runs `npm run build` with full deps
      (Next needs devDependencies to build); `prod` copies only
      `.next/standalone` + `.next/static` + `public` + `prisma` (no
      `node_modules` install at all — standalone tracing supplies the
      pruned runtime deps) and runs `node server.js`. Required adding
      `output: "standalone"` to `next.config.ts` (no other change to it —
      HSTS/CSP header work stays a separate deliverable). `docker/worker.Dockerfile`
      got a `prod-deps`+`prod` pair: `npm ci --omit=dev` plus `tsx` added
      back explicitly (needed at runtime, kept per your instruction to stay
      consistent with dev), copying only `src/worker`+`src/lib`+`prisma`
      (confirmed via import grep: worker has zero reachable imports outside
      those two directories, all relative paths, no `@/` alias — so nothing
      else needs copying). Existing `dev` targets in both Dockerfiles
      untouched. Verified by actually building both images
      (`docker build --target prod`, both exit 0) and running them as real
      containers on the dev Postgres network (ports 3001/no-port,
      `investment_hub_default` network): prod app container served
      `/api/health` → `200 {"status":"ok","database":"reachable"}`; prod
      worker container logged all 5 cron jobs scheduled and stayed up with
      no crash. Confirmed the running dev `docker compose` stack
      (`app`/`worker`/`postgres`) was never touched — checked `docker compose ps`
      and re-hit dev's own `:3000/api/health` before and after, both 200.
      Test containers and test-tagged images removed after verification.
- [x] **SCRUM-125 — done, then superseded/re-done on 2026-09-16.** First
      attempt used Railway's new `.railway/railway.ts` Infrastructure-as-Code
      TypeScript DSL (Config as Code / `railway.json`/`.toml` was already
      confirmed unusable — deprecated, and closed to any service with no
      prior Railway history, which this project has). That attempt hit a
      real blocking bug: the published `railway` npm package's CLI-version
      check (`assertMinimumIacCliVersion`) reads `process.env._` to locate
      the Railway CLI's own executable — `$_` is a shell "last argument of
      previous command" convention, not a program path (verified directly:
      right after running `railway --version`, `$_` held the string
      `"--version"`, never the CLI's path), and on Windows PowerShell
      specifically this has no reliable value at all, so the check always
      fails with "requires Railway CLI 5.42.1+" regardless of the real
      installed version (5.57.2, current). Confirmed this is unfixable from
      our side (package already at latest npm version, 3.11.0; no beta/next
      dist-tag exists). **Decision (user, 2026-09-16): abandon the IaC
      approach entirely.** Removed `.railway/` (was untracked, never
      committed — safe to delete outright) and its now-dead `.gitignore`
      entries. Switched to pure Railway-dashboard configuration: wrote
      `docs/runbook.md` documenting every `app`/`worker` service setting
      (build source + Dockerfile path + stage reasoning, start command,
      healthcheck path/timeout, restart policy, port, env vars) as exact
      manual dashboard steps, plus the least-privilege `app`/`migrator`
      Postgres role SQL, migration strategy, rollback procedure, safe
      job-re-trigger commands, and the still-pending backup-service section
      (honestly marked incomplete — its script/Dockerfile don't exist yet).
      No `railway.json` was written — confirmed with you that writing one
      for a service with zero prior Railway history risks Railway silently
      ignoring it (same deprecation-cutoff reasoning that ruled out the IaC
      path's alternative). `/api/health` (Phase 12) is the documented
      healthcheck path for `app`.
- [x] **SCRUM-126 — done.** Wrote `scripts/db-setup.sql` (plain SQL, no
      string interpolation, run manually — not app code). One real
      correction from your original spec: you asked for `app` to get
      SELECT/INSERT/UPDATE only (no DELETE); confirmed with you first that
      real production code genuinely needs DELETE on non-ledger tables
      (`session.ts`'s logout/session-revoke, `pending-auth.ts`'s
      consume-on-success) — you agreed to grant DELETE broadly and instead
      carve out `ledger_entries` specifically (SELECT/INSERT only there,
      matching invariant #2), rather than breaking real login/logout flows.
      **Second, more structural finding from actually testing this against
      a real database** (not just writing plausible-looking SQL): the
      script must run in **two parts**, not one shot —
        1. Part 1 (roles + `ALTER DEFAULT PRIVILEGES`) must run BEFORE the
           first `prisma migrate deploy`, because Postgres DDL rights
           (ALTER/DROP) are governed by table *ownership*, not schema-level
           grants — verified by reproducing the exact failure (a
           pre-existing table could NOT be ALTERed by `migrator` despite a
           broad `GRANT ALL ON SCHEMA`). Running Part 1 first means
           `migrator` itself creates every table via the subsequent
           migration, so it owns everything from the start.
        2. Part 2 (`REVOKE UPDATE, DELETE ON ledger_entries FROM app`) must
           run AFTER that migration, because `ledger_entries` doesn't exist
           yet beforehand — also reproduced directly (`ERROR: relation
           "ledger_entries" does not exist`).
      **Verified end-to-end for real**, not just reasoned about: created a
      scratch Postgres database, ran Part 1, ran a real `prisma migrate
      deploy` as `migrator` (all ~30 real migrations applied cleanly),
      ran Part 2, then confirmed via direct `psql` attempts as each role:
      `app` genuinely cannot `DROP`/`ALTER` any table (`must be owner of
      table`) or `UPDATE ledger_entries` (`permission denied`), while
      retaining full SELECT/INSERT/UPDATE/DELETE on an ordinary table
      (`sessions`); `migrator` could fully `ALTER`/`DROP` tables it created.
      Cleaned up every scratch database/role afterward — confirmed via
      `\du`/`\l` that only the real `postgres` role and `investment_hub`
      database remain, and the running dev stack's `/api/health` was
      unaffected throughout. Updated `.env.example` with
      `APP_DATABASE_URL`/`MIGRATOR_DATABASE_URL` as documented reference
      values (Prisma's datasource always reads the single `DATABASE_URL`
      var — these two show which connection string it should hold in each
      context, not new variables the code itself reads). Rewrote
      `docs/runbook.md`'s "Least-privilege database roles" and "Running
      migrations" sections to reference the real two-part script and
      explain the ownership/ordering constraint, instead of the earlier
      inline (untested, single-shot) SQL draft from the SCRUM-125 pass.
- [ ] Audit + extend Next.js middleware for HSTS/CSP/etc. security headers
      (check Phase 12's `middleware.ts` first).
- [x] **SCRUM-127 — done.** One spec correction, confirmed with you first:
      the ticket described "keep last 7 daily, 4 weekly, 3 monthly"
      (fixed-count), but `docs/backup-strategy.md` section 2 — the
      project's actual pre-existing source of truth for this policy —
      specifies an age-tier scheme (every daily for 7 days, one-per-week
      for 8–30 days, one-per-month for 31–90 days, delete beyond 90,
      always keeping the *oldest* backup in a collapsed tier). Implemented
      the documented age-tier policy, not the ticket's paraphrase.
      Wrote `scripts/backup.sh`: `pg_dump -F c` (custom format, per
      backup-strategy.md §1) → immediate `pg_restore -l` verification (a
      dump that can't be read is treated as a failed backup, not silently
      kept) → retention pruning → a clearly marked `TODO` for the
      off-box-sync step (still not decided, per tasks/todo.md's open
      question). Reuses the **`app`** role's connection string for the
      dump (confirmed with you: `app` already has SELECT everywhere and no
      DDL, sufficient for `pg_dump`, avoiding a fourth credential/role).
      **Two real bugs found and fixed by actually running the script, not
      just reading it**:
        1. `pg_dump` rejects Prisma's `?schema=public` query parameter
           outright (`invalid URI query parameter: "schema"` — libpq has
           no concept of it, it's a Prisma Client-only convention). Fixed
           by stripping just that parameter (via `sed`, tested against 5
           realistic query-string shapes: schema alone, schema+sslmode in
           either order, three params, no params at all) before handing
           the URL to `pg_dump`/`pg_restore`, while preserving any other
           real parameter (sslmode, etc.).
        2. `docker/backup.Dockerfile`'s first draft installed
           `postgresql-client-16` from plain `debian:12-slim`'s default
           apt repos — build failed outright (`Unable to locate package`),
           since bookworm's default repos only ship version 15. Fixed by
           adding the official PGDG apt repository explicitly before
           installing (matches the real Postgres server version, 16.14,
           confirmed via `postgres --version` against the dev container —
           pg_dump/pg_restore should match or exceed the server version).
      **Retention logic tested in isolation** against fabricated backup
      files at every tier boundary (ages 6/7/8, 29/30/31, 89/90/91 days,
      plus a realistic 30-file spread across all four tiers) before
      trusting it — confirmed the "keep oldest in a collapsed tier" rule
      holds and all three boundaries (7/30/90 days) land on the correct
      side of backup-strategy.md's stated inclusive ranges.
      **Then verified the whole container end-to-end for real**: built
      `docker/backup.Dockerfile`, ran it against the real dev Postgres via
      a bind-mounted volume, confirmed a genuine 446KB dump landed with
      166 TOC entries and the correct database name, and independently
      re-verified that same file's restorability from a second, fresh
      container. (One environment-only false alarm along the way, not a
      script bug: a Git Bash `/tmp` path silently failed to bind-mount
      through Docker Desktop on Windows — switched to a Windows-native
      host path and the mount worked correctly; Railway's own volumes
      won't go through this Git-Bash-specific translation at all.)
      Cleaned up every test image/container/scratch file afterward;
      confirmed the running dev stack was undisturbed throughout
      (`docker compose ps` + `/api/health` before and after).
      Updated `docs/runbook.md`'s "Postgres backups" section (previously a
      placeholder) with the real service configuration: build settings,
      schedule recommendation, volume mount point, env vars, and a
      first-run verification step — replacing the earlier "not yet
      implemented" note.
- [x] **Restore procedure** — already fully written in
      `docs/backup-strategy.md` section 3 (pre-existing, not part of this
      session's work) with an explicit step-by-step stop/copy/drop-recreate/
      restore/verify/restart sequence. **Not yet rehearsed against a real
      restore in this session** — that's part of the Exit Test checklist
      near the bottom of this file, not a standalone item; rehearsing it
      now would be premature before the Railway deployment itself exists
      to rehearse against.
- [x] **SCRUM-128 — done.** Audited every `console.log`/`console.error` call
      in `src/worker/index.ts` (20 calls: 5 jobs × trigger/completed/failed,
      plus 5 startup lines) and confirmed the 5 job functions themselves
      (`daily-interest-job.ts`, `binary-cycle-job.ts`,
      `rank-evaluation-job.ts`, `rank-payout-job.ts`,
      `reconciliation-job.ts`) have no console calls of their own — all
      worker logging happens at this one entrypoint boundary. Added a small
      `logJob(level, job, message, extra?)` helper (plain
      `JSON.stringify`, no new library, per the ticket) and replaced every
      call site. Each line: `timestamp` (ISO 8601), `level`
      (`"info"`/`"error"`), `job`, `message`, plus `error` on failure.
      Reused each job module's own already-exported `*_JOB_TYPE` constant
      (`daily_interest`, `binary_cycle`, `rank_evaluation`, `rank_payout`,
      `reconciliation` — same strings the `job_runs` table itself uses) for
      the `job` field instead of re-typing string literals, so the log
      output and the `job_runs` rows can never drift apart. Verified for
      real, not just read through: ran the worker directly (`npx tsx
      src/worker/index.ts`) and captured actual output — 6 valid JSON lines
      (1 "worker started" + 5 schedule announcements), each independently
      `JSON.parse`-able with the right keys; also restarted the real dev
      `worker` container and confirmed the same structured output appears
      there (`docker logs investment_hub-worker-1`) and a subsequent
      06:05-scheduled catch-up ran fine (`daily interest job completed`
      visible pre-restart, matching prior behavior). Ran all 5 job test
      files (20 tests) after the import changes (added named imports of
      the `*_JOB_TYPE` constants alongside each existing `run*CatchUp`
      import) — all pass, no regressions. `tsc --noEmit` clean. Updated
      `docs/runbook.md`'s "Structured logging" section with the real field
      list and a captured example of actual output, replacing the earlier
      placeholder description.
- [ ] `.env.example` updated for any new prod-only variables introduced
      (`app`/`migrator` role connection strings, backup retention count,
      etc.) — values-free.
- [x] **Deployment runbook (`docs/runbook.md`) — first draft done as part of
      the SCRUM-125 redo above.** Covers: why no config file, `app`/`worker`
      dashboard settings, least-privilege `app`/`migrator` role SQL,
      migration strategy, rollback, safe job re-trigger, and the exit-test
      checklist. **Still incomplete on purpose**: the backup/restore section
      is a placeholder until the backup script + Dockerfile exist (separate
      checklist item above); the runbook says so explicitly rather than
      documenting steps for something that isn't built. Revisit once that
      lands, and again once security-header/structured-logging work below
      is done, so the runbook stays accurate rather than aspirational.
- [ ] Run the actual Exit Test on the real Railway deployment and show real
      output/screenshots: HTTPS reachable with valid TLS on the custom
      domain, worker running and its first scheduled job actually
      processed, DB reachable via the least-privilege `app` role, a backup
      taken and a restore rehearsed to prove it works, the worker killed
      and confirmed to auto-restart, and the catch-up logic confirmed to
      credit a deliberately-missed interest day correctly after restart.

Nothing above gets implemented until you confirm this checklist (and answer
the two remaining items above: domain name, Railway CLI access).
