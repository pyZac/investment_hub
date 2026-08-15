# Lessons

> Append a short entry here every time Zac corrects something. Read this file in
> full at the start of every session, before doing anything else. Keep entries
> short — one mistake, one rule. Prune entries that have become redundant with a
> standing rule in CLAUDE.md.

<!-- Example format:
## 2026-08-10 — Phase 4
Mistake: used `new Date()` inside `dailyRate()` instead of taking a date param.
Rule: every engine function signature must take `forDate: Date` explicitly — no
exceptions, even for "just a quick helper."
-->

## 2026-08-09 — Phase 0
Mistake: `npx prisma init` (latest) installed Prisma 7, which requires a driver
adapter, a new `prisma.config.ts`, and a generated-client output path — a much
bigger surface change than this Prisma-heavy 13-phase project should absorb
silently.
Rule: when a scaffolding/init command pulls "latest" and that version changes
core conventions from what the docs assume, stop and confirm the target major
version with the user before continuing, rather than proceeding on the newest
default.

## 2026-08-09 — Phase 0
Mistake: while cleaning up stray directories created by `prisma init` (which
wrote skill files into `.claude/skills/`), deleted two files that were actually
committed project skills (`bilingual-rtl`, `money-precision`), not scaffolding
byproducts.
Rule: before deleting any file/directory that a tool created inside an existing
project directory, check `git status`/`git show HEAD --stat` first to confirm
nothing pre-existing is being swept up in the cleanup.

## 2026-08-11 — Phase 1
Mistake: wrote a test helper that created a second `isMainAdmin: true` user,
which hit the DB-level partial unique index (from the users/admin_permission_grants
task) and failed — the seeded main admin already occupies that slot in the dev DB
that tests run against directly (no isolated test DB exists yet).
Rule: tests in this project run against the real dev Postgres instance, not a
sandboxed/reset DB — any test needing "the main admin" should look up the
already-seeded one (`findFirstOrThrow({ where: { isMainAdmin: true } })`) rather
than creating a new one, and afterAll cleanup must delete child rows
(admin_actions, admin_permission_grants) referencing test-created users before
deleting the users themselves, in FK-safe order.

## 2026-08-11 — Phase 1
Mistake: rate-limit tests used a helper `uniqueIp()` returning
`` `10.x.x.${Math.floor(Math.random()*250)+1}` `` (only ~250 values) as a fake
per-request IP key, with no `afterAll` cleanup of the `security_events` rows
created. Rows persist forever in the shared dev DB across test runs, so a
narrow random range collided within a handful of runs and made an unrelated
test's "under threshold" case flakily see 5+ prior failures and throw.
Rule: any test key standing in for a real-world identifier (IP, idempotency
key, etc.) must be collision-proof against both the current run and everything
already sitting in the DB from prior runs — use `crypto.randomUUID()`-derived
values, not a small numeric random range — and any table a test writes to
needs `afterAll` cleanup even if it "shouldn't" affect other tests.

## 2026-08-12 — Phase 1
Mistake: patched individual slow tests with a per-test 15000/20000ms timeout
override each time argon2-heavy tests hit Vitest's 5s default, instead of
fixing the actual cause. As the suite grew (10 files running in parallel,
each spinning up argon2 hashing), previously-fine tests started timing out
under system load even without changing their own logic.
Rule: this suite's bottleneck is CPU-bound password/answer hashing under
parallel test-file execution, not any one slow test — set `testTimeout` once
in `vitest.config.ts` (20000ms) rather than sprinkling per-test overrides;
revisit the global value if the suite keeps growing rather than patching
individual failures as they appear.

## 2026-08-12 — Phase 1
Note (not a correction, a standing constraint): `next/headers`'s `cookies()`
throws "called outside a request scope" when invoked from plain Vitest —
there is no live Next.js request context in a unit test. Any guard/helper
that reads the session cookie (`route-guard.ts`'s `requireSession` and
everything built on it) takes an optional `tokenOverride` param used only by
tests; real callers (routes/server actions) never pass it. Apply the same
pattern to any future helper that needs `cookies()`/`headers()` and also
needs unit-test coverage.

## 2026-08-13 — Phase 2
Mistake: designed `ledger_entries`' idempotency uniqueness as
`UNIQUE(idempotency_key, user_id, wallet, direction)` without accounting for
Postgres treating every `NULL` as distinct in a unique index — two
`SYSTEM_EXTERNAL` rows (`user_id IS NULL`) with the same
key/wallet/direction did NOT collide, silently defeating the UNIQUE guarantee
for exactly the rows representing money entering/leaving the simulation. A
test that deliberately tried this replay caught it (resolved instead of
rejecting).
Rule: any UNIQUE/composite-index column that can be NULL needs a functional
index with `COALESCE(col, sentinel)` instead of a plain column list, if NULL
rows must collide with each other for the invariant to hold. Prisma's schema
DSL can't express expression indexes — write them by hand in migration.sql
and add a comment in schema.prisma explaining why no `@@unique` is declared
there (so a future `migrate dev` doesn't try to recreate a conflicting plain
index). Always write a test with two NULL-bearing rows sharing the same key
before trusting a composite unique constraint that includes a nullable column.

## 2026-08-13 — Phase 2
Mistake: `reconciliation.test.ts` collected ledger rows to clean up via
`findMany({ where: { userId: user.id } })` after calling `adminCreditWalletB`.
That filter only matches the real-user-side row, never the paired
SYSTEM_EXTERNAL row (`userId: null`) from the same transaction — so
SYSTEM_EXTERNAL rows were never deleted in `afterAll` and accumulated across
runs, corrupting the global-solvency check for every later `runReconciliation()`
call in the same DB (a false "drift" from leftover test data, not a real bug).
Rule: any test cleanup for a `postTransaction`-produced pair must collect rows
by `idempotencyKey` (matches every row the call wrote, including
`userId: null` ones), never by `userId` alone — same root cause as the
NULL-collision lesson above, applied to test cleanup instead of a DB
constraint. Caught by running the full suite twice in a row and seeing a test
that passed alone fail once other tests' leftovers were present.

## 2026-08-13 — Phase 2
Mistake: after adding `reconciliation.test.ts` (which asserts on the *entire*
wallets/ledger_entries tables — a true global solvency check, by design),
running the full suite intermittently failed (~1-in-5 runs) even though the
file passed every time run alone. Root cause: Vitest runs test files in
parallel worker processes by default, all against the same shared dev
Postgres instance (no isolated test DB). Every other test file only asserts
on rows scoped to IDs it created, so parallelism never mattered before — this
was the first file whose assertion scope was "everything," so it was the
first to expose the DB being genuinely shared and concurrently written.
Rule: `fileParallelism: false` in vitest.config.ts. Any future test needing a
true global/whole-table assertion should assume this suite runs sequentially,
not race-condition-free by accident — if a test seems to want to check
"nothing else in the DB is wrong," it needs the whole suite serialized, not
per-file tricks.

## 2026-08-14 — Phase 2 — KNOWN DEV-ENVIRONMENT QUIRK, not fully root-caused
While verifying Phase 2's migration state before the exit test, the dev Postgres
container's schema was observed to get wiped and fully replayed from migration
files (`DROP SCHEMA public CASCADE` → `CREATE SCHEMA public` → replay all
migration SQL in order — the exact signature of `prisma migrate reset --force`)
multiple times in one session, roughly 3-5 minutes after each rebaseline, with NO
`migrate reset` command ever typed and no killed/timed-out process involved in at
least one occurrence. Investigated and ruled out: the Vitest test suite (ran clean
repeatedly with the table intact before/after), Vitest global setup/teardown (none
exists), the `app`/`worker` Docker containers' own processes (confirmed via
`/proc` inspection — worker is an idle stub, app is plain `next dev`, neither runs
Prisma CLI code), cron inside the postgres container (not installed), container
restarts (`RestartCount: 0` throughout), and a second/duplicate Postgres instance
(only one process on port 5432, one `investment_hub` database). Turning on
`log_statement=ddl` confirmed the wipe is real DDL executed by some Postgres
client, but did not reveal which process/tool issued it (no `log_connections`
data was captured). Note: `log_statement=none` is the container's default, so
`docker logs` alone is unreliable for this kind of investigation — it only
captures errored statements, which produced a misleading timeline on the first
investigation pass. Query `_prisma_migrations` directly via `psql` or the Prisma
client to check ground truth, not container logs.
Rule: if `prisma migrate status` reports all/most migrations "not yet applied"
despite the schema clearly already being structurally correct
(`prisma migrate diff --from-migrations ... --to-url ...` reports "No difference
detected"), this is the known quirk, not a real drift — do NOT run `migrate dev`
or `migrate reset` to "fix" it (that's the actual destructive action to avoid).
Instead: run `prisma migrate resolve --applied <name>` for all 10 migrations
**one at a time** (not in a shell loop, to rule out any loop/timeout interaction),
confirm `migrate status` is clean, then `npx tsx prisma/seed.ts` to restore the
main admin. This is unresolved at the infrastructure level — treat it as a
standing possibility to check for at the start of any future session in this
project, not something to re-investigate deeply again unless it starts causing
actual data loss beyond the dev main-admin seed (which is trivially recreated).

## 2026-08-14 — Phase 2
Mistake: the Phase 2 exit-test script's cleanup deleted ledger rows via
`where: { userId: user.id }`, which — same root cause as the earlier
reconciliation.test.ts lesson — misses the paired SYSTEM_EXTERNAL row
(userId null) from the same postTransaction call. Left an orphaned row that
broke the next full-suite run's reconciliation "clean" test.
Rule: this is now the second time this exact mistake happened. Any one-off
script (not just permanent test files) that calls postTransaction/
adminCreditWalletB and then cleans up afterward must collect rows to delete
by idempotencyKey, never by userId alone — make this the default habit for
any ad-hoc verification script touching the ledger, not just permanent tests.

## 2026-08-13 — Phase 2
Note (not a correction, a standing constraint): once a migration's SQL file is
hand-edited after `prisma migrate dev` already applied it (e.g. adding a
constraint the auto-generated SQL didn't include), Prisma's checksum check
means any later `migrate dev` call will refuse and offer to reset the dev
database — destructive, wipes the seeded admin and all data. The fix is not
to reset: hand-write the next migration folder/SQL directly and apply with
`prisma migrate deploy`, which doesn't do checksum-drift verification. Once a
migration has been hand-edited post-apply, use `migrate deploy` (not `migrate
dev`) for all subsequent migrations in this project.
