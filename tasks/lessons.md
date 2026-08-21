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

## 2026-08-15 — Phase 3
Mistake: none by me, but a real environment gotcha hit while manually
verifying SCRUM-45's purchase page in-browser. The `app` container's
`node_modules` and `@prisma/client` are anonymous Docker volumes
(`docker-compose.yml`'s `- /app/node_modules`), separate from the host's. Host
`npm install`/`prisma generate` since the container was first built never
propagated in, so `/api/auth/login` 404'd (Next's router silently skipped a
route whose import chain failed) until traced to `Module not found: 'argon2'`
in the container, then a second failure (`Cannot read properties of
undefined (reading 'findFirst')`) until `npx prisma generate` was also rerun
inside the container.
Rule: whenever manually verifying a page/route in the running `app` container
after adding a dependency or changing schema, run `docker compose exec app
npm install` and `docker compose exec app npx prisma generate` (then `docker
compose restart app`) first if anything 404s unexpectedly or throws on a
route that clearly exists — don't assume host-side `npm install`/`prisma
generate` reached the container. This is a known standing quirk of this
project's dev setup, not something to re-diagnose from scratch each time.

## 2026-08-15 — Phase 3
Mistake: found 4 leftover `Test-<uuid>` rows in the real dev `packages` table
(interrupted `packages.test.ts` run left them behind despite that file's
`afterAll` cleanup existing) — they were visible on the actual SCRUM-45
packages page during design review, not just in test runs.
Rule: a test file having `afterAll` cleanup isn't a guarantee against
leftover data if a run crashes/is killed mid-suite — periodically sanity
-check real product-facing tables (especially ones a human reviews visually,
like `packages`) for lingering test artifacts before a design/demo session,
not just during dedicated cleanup passes.

## 2026-08-16 — Phase 4 (SCRUM-48)
Mistake: wrote `interest_rate_config`'s "only one active rate" constraint as a
partial unique index directly on the nullable column —
`CREATE UNIQUE INDEX ... ON interest_rate_config (effective_to) WHERE
effective_to IS NULL`. This looks correct (and matches how the Phase 2 ledger
fix reasons about NULLs) but doesn't work: Postgres treats every NULL as
distinct for uniqueness even inside a partial index, and indexing a column
that is NULL on every matching row can never catch a second NULL — verified
by inserting three concurrent `effective_to IS NULL` rows with zero
conflicts. Caught by deliberately testing the constraint (inserting a second
active row) rather than assuming a valid-looking index definition worked.
Rule: a partial unique index meant to enforce "at most one row" needs a
unique index on a **constant expression** (e.g. `((TRUE))`), not on the
nullable column itself — the `WHERE` clause does the filtering, the indexed
expression just needs to be the same non-null value on every qualifying row
so a second row's insert actually collides. Always insert a second
would-violate row by hand (not just trust `\d tablename` showing the index
exists and is valid) before treating any new UNIQUE constraint as verified —
"the index exists" and "the index enforces what I intended" are different
claims, especially with NULLs involved (this is the second time NULL
semantics broke an intended uniqueness guarantee in this project — see the
Phase 2 ledger entry above).

## 2026-08-16 — Phase 4 (SCRUM-51)
Mistake: `runDailyInterestCatchUp`'s fallback for "no prior job_runs row exists
yet" was a hardcoded `JOB_EPOCH = 2026-01-01`, chosen without checking it
against `interest_rate_config`'s actual seeded `effective_from`
(2026-08-16, whenever SCRUM-48's migration was run) — so a first-ever
catch-up call walked back to January and hit "no active interest rate" for
every date before the config seed. This wasn't caught by the test's `expect`
assertions (which used explicit dates near the tested gap) but surfaced as
~220 leftover `job_runs` rows spanning 2026-01-01 through 2026-08-08 in the
shared dev DB after a mid-development test run crashed before its `afterEach`
cleanup ran — a stray full-suite run later would have silently inherited this
as "last completed period" state and skewed catch-up math for every
subsequent test in the file.
Rule: (1) any hardcoded epoch/fallback date in catch-up-style logic needs to
be checked against real seeded config data it will look up, not chosen
independently; (2) prefer seeding an explicit prior-COMPLETED `job_runs`
baseline row in each test (per the specific gap being tested) over relying on
a global epoch fallback, both because it's more realistic (production
catch-up logic only matters after the job has run at least once) and because
it keeps each test's date range self-contained; (3) after any test run that
errors/crashes before reaching its `afterEach`/`afterAll`, explicitly check
the tables that test writes to for leftover rows before trusting the DB is
clean again — a crash mid-suite bypasses cleanup the same way a killed
process does (see the Phase 3 packages-table lesson above), and this applies
even to jobs/tables introduced in the same session, not just older ones.

## 2026-08-16 — Phase 4 (SCRUM-52)
Mistake: the SCRUM-51 lesson above already flagged that a hardcoded
`JOB_EPOCH` fallback for "no prior job_runs row" was fragile, but the actual
fix I applied there only made the epoch closer to the config seed date — it
didn't remove the backward-walk design itself. Manually triggering
`runDailyInterestCatchUp` against the real dev environment (as this task
required, not just running the test suite) immediately reproduced the same
class of bug live: with zero job_runs history, it walked back to
`JOB_EPOCH` and created 228 rows through today, "succeeding" only because
both real dev investments' `profitStartsAt` was still in the future (so
`accrueDailyInterestForInvestment` skipped before ever calling `dailyRate`,
masking what would otherwise have been 228 "no active interest rate config"
errors for dates before the config's real seed date).
Rule: catch-up logic's "no history yet" case is not "assume some safe-ish
starting epoch" — it is "there is nothing to catch up on; today is the only
period." A job that has never run before was never "missed" for any prior
day, by definition (there's no prior successful run to have fallen behind
from). This is now a general rule for this project: any job_runs-style
catch-up bootstrap should default the walk-back start to `today` when no
prior COMPLETED row exists, never to a fixed calendar date, even one that
looks safely in the past. Also: **manually exercising a job against the real
dev DB is not optional verification** — this bug was invisible in the test
suite (tests always seed an explicit baseline row before calling the
function, per the SCRUM-51 lesson) and only surfaced when actually run
live, which is exactly why this task's instructions required a live manual
trigger, not just green tests, before considering it done.

## 2026-08-16 — Phase 4 (SCRUM-54)
Mistake #1: the Phase 4 exit test (a 90-fabricated-day run calling the real
`runDailyInterestCatchUp`) swept in the two real pre-existing dev investments
alongside the test's own — because that function correctly queries every
`status: "ACTIVE"` investment in the DB, not just ones a test created, and
this shared dev DB has no isolated test DB (per the earlier Phase 2 lesson).
The real investments' `profit_starts_at` fell inside the test's fabricated
90-day window, so they received real (fabricated-date) interest credits,
corrupting one real user's Wallet A cached balance to ~511 million before
being caught and manually repaired (delete the polluting ledger rows,
recompute the cached balance from the remaining real ledger sum, verify
`SUM(ledger) == wallets.balance` again). Happened twice in a row — the first
repair didn't yet include the fix, so the second run reproduced it.
Rule: any test that exercises a function operating on "every X in the
system" (not scoped to IDs the test created) — cron-catch-up jobs, global
reconciliation-style queries — must neutralize pre-existing real data for its
own duration if it shares a DB with real state, not just clean up its own
created rows afterward. Here: suspend (`suspendedAt`) every other user with
an ACTIVE investment before running, restore exactly those users afterward
(never a blanket "unsuspend everyone", which could wrongly reinstate an
already-suspended real user).

**Standalone principle — how to repair any corrupted `wallets.balance`,
regardless of cause**: `wallets.balance` is a cache; `ledger_entries` is the
only source of truth (invariant #2 — no ledger UPDATE/DELETE, ever; the cache
exists purely for read performance, per Decision 1). If a cached balance is
ever found wrong — from a bug like this one, a bad migration, manual DB
surgery, anything — the fix is always: **recompute it from scratch by
summing the real ledger_entries for that user+wallet
(`SUM(CREDIT) - SUM(DEBIT)`), then overwrite the cache with that queried sum.**
Never decrement/increment the existing cached number by an estimated
correction amount, and never type in a value you calculated by hand instead
of querying it — both leave the cache one step removed from the ledger
instead of exactly derived from it, and either can silently compound a prior
arithmetic slip. `runReconciliation()` (`src/lib/reconciliation.ts`) is the
tool for both ends of this: run it first to detect and locate exactly which
user/wallet has drifted (its report gives the wallet, the drift amount, and
direction), then run it again after the repair as the proof the fix is
correct — a clean report with zero mismatches, not a manual balance
comparison, is what closing out a cache-corruption repair looks like. This
is the same operation the nightly reconciliation job and Phase 2's exit test
already formalize; a manual repair is just this principle applied by hand to
one row instead of the whole table.

Mistake #2: the exit test's own verification query
(`prisma.ledgerEntry.aggregate({ where: { referenceType, referenceId,
entryType: "DAILY_INTEREST" }, _sum: { amount } })`) omitted `wallet: "A",
direction: "CREDIT"`. Since DAILY_INTEREST writes a paired SYSTEM_EXTERNAL
DEBIT entry tagged with the *same* `referenceType`/`referenceId` (both sides
of the double-entry pair reference the investment), the unfiltered aggregate
summed both the CREDIT and DEBIT amounts — which are equal — producing
exactly 2x the correct total. The real engine code
(`daily-interest.ts`'s own `priorInterest` lookup) already had the correct
`wallet: "A", direction: "CREDIT"` filter; only the test's independent
verification query was missing it, so this was a test bug, not an engine
bug — confirmed by manually re-summing the same rows in JS and getting the
correct (undoubled) total.
Rule: **any query that sums ledger_entries by `referenceType`/`referenceId`
alone must also filter `wallet` and `direction`**, because those reference
fields intentionally tag both sides of a double-entry pair, not just the
"primary" side — this is true anywhere in the codebase, not just tests. When
a computed total is suspiciously exactly 2x (or 0.5x) an expected value,
check for a missing direction/wallet filter on an aggregate before assuming
the underlying business logic is wrong.

Mistake #3 (design correction, not a bug): a pure 90-day compounding
reference computed with full (unrounded) Prisma.Decimal precision diverged
from the real system's output at the 5th decimal place after ~72 compounding
steps, because the real system stores and re-reads each day's credited
amount from a `NUMERIC(24,8)` column — rounding to 8dp — before using it as
the next day's compounding base, while the unrounded reference carried full
precision throughout. Fixed by rounding each day's computed interest to 8
decimals (`ROUND_HALF_UP`, confirmed empirically to match Postgres's own
`numeric(24,8)` cast rounding behavior) inside the reference simulation
itself, matching what the real persisted system actually does.
Rule: an independent reference for a system that persists intermediate
values in a fixed-precision column must round at the same points the real
system rounds, or the two will genuinely diverge over many compounding
steps — this is not decimal.js precision-setting relevant (that only
prevents *the reference's own* precision cliff from 20 default significant
digits; it doesn't make the reference match a rounding-per-step system,
which requires deliberately replicating the rounding, not just having more
of it).

## 2026-08-15 — Phase 3 (SCRUM-45)
Mistake: after a successful purchase on the packages page, the displayed
Wallet B balance stayed stale until a manual browser reload. Root cause: the
page (`src/app/[locale]/packages/page.tsx`) is a Server Component that reads
`getWalletBalance` once at render time and passes it down as a prop; the
server action (`purchasePackageAction`) wrote the new balance to the DB but
never told Next.js the route's cached render was now stale, so the
already-mounted client tree kept showing its original props indefinitely.
Rule: any server action that mutates data a currently-rendered page displays
must call `revalidatePath(...)` (or `revalidateTag` if the data is fetched via
a tagged cache entry) for the exact affected path before returning success —
this is not optional polish, a mutation with no revalidation call is an
incomplete implementation. Fix applied here: `purchasePackageAction` takes a
`locale` param from the client (via next-intl's `useLocale()`) and calls
`revalidatePath(`/${locale}/packages`)` right after `purchasePackage`
succeeds, so Next re-renders the Server Component and pushes fresh props
(updated wallet balance, updated purchasable-package list) to the already
-mounted client component with no manual reload. Apply this same pattern from
the start for every future action that changes wallet balances or list
contents a page displays — withdrawals, transfers, admin credit, package
CRUD's effect on the admin package list, etc. — don't wait for a bug report to
add it retroactively.

## 2026-08-15 — Phase 3 (SCRUM-45)
Mistake: two related RTL layout bugs shipped in the first review pass of the
purchase confirmation dialog, both from the same root cause — relying on
`dir="rtl"` alone instead of using explicit logical layout:
1. The success state's checkmark icon + "Purchase complete" text rendered
   stacked (icon above text) instead of as a horizontal pair, because it sat
   inside `DialogTitle`/`DialogHeader` with no explicit horizontal flex
   wrapper — `flex-col`/block stacking has no direction concept at all, so
   this wasn't even an RTL-specific bug, just a missing `flex-row`, but it
   only got caught during the Arabic pass.
2. The dialog's × close button (shared shadcn primitive,
   `src/components/ui/dialog.tsx`) used a **physical** Tailwind class,
   `absolute top-2 right-2` — pinned to the physical right edge in both
   locales. In the English (LTR) dialog this happens to be the visually
   correct corner, masking the bug; in Arabic (RTL) it should mirror to the
   opposite visual corner but stayed physically right, reading as
   overlapping/cramped against the title instead of mirroring.
Rule: any icon+text pairing (buttons, badges, toasts/dialogs, list items)
needs an explicit `flex flex-row items-center gap-<n>` wrapper — never rely on
default block/inline flow to keep them horizontally paired. Any
absolutely-positioned element anchored to a horizontal edge (close buttons,
corner badges, floating action buttons) must use Tailwind's **logical** inset
utilities — `start-*`/`end-*` (`inset-inline-start`/`inset-inline-end`) —
never physical `left-*`/`right-*`, so it automatically mirrors under
`dir="rtl"` with zero extra code. Fix applied here:
`className="absolute top-2 right-2"` → `className="absolute top-2 end-2"` in
`dialog.tsx` (a shared primitive, so this fixes every dialog in the app, not
just this page) plus `flex flex-row items-center gap-2` on the success
`DialogTitle`'s icon+text wrapper. Add this as a specific item in the
bilingual-rtl skill's verification pass: when checking a screen in `/ar`,
explicitly inspect every icon+text pair and every absolutely-positioned
corner element, not just check that visible strings are translated — this
category of bug is invisible in a translation-only review and only shows up
on a real side-by-side `/en` vs `/ar` visual comparison. Expect many more
icon+text pairs in Phase 10/11's dashboards; check for physical
`left-*`/`right-*`/`ml-*`/`mr-*`/`pl-*`/`pr-*`/`text-left`/`text-right` on any
new component before it ships, not after a bug report.

## 2026-08-17 — Phase 5 (SCRUM-55/56)
Mistake: `daily-interest.test.ts` had 3 real `tsc --noEmit` errors (accessing
`result.reason` after `expect(result.skipped).toBe(true)`, which is a
runtime check TypeScript's control-flow narrowing can't see — `AccrualResult`
is a discriminated union and `.reason` only exists on the `skipped: true`
branch). These were reported as "pre-existing, unrelated to this task" across
two consecutive task summaries (SCRUM-55, then SCRUM-56) without ever being
fixed or logged as a tracked item — they slipped through unnoticed because
`vitest` runs tests via esbuild/transform, not `tsc`, so the runtime suite
stayed green while `tsc --noEmit` failed independently; nothing surfaces that
divergence unless both are actually run and their outputs compared.
Rule: "pre-existing and unrelated to my change" is not the same as "safe to
leave alone" — if a `tsc --noEmit` (or any full-project check) error is
noticed while verifying a task, either fix it in the same session or add an
explicit tracked entry (this file or todo.md) before moving to the next
task, never just mention it in a chat summary and let it ride. Chat summaries
are not tracking. Fixed here by narrowing with `if (!result.skipped) throw
...` immediately after the runtime assertion, so both the test's own logic
and the type checker agree on which branch it's in.

## 2026-08-18 — Phase 5 (SCRUM-61)
Mistake: after SCRUM-61 shipped the withdrawals page, the user hit an
intermittent runtime crash in the browser — "Invalid environment
configuration: DATABASE_URL expected string, invalid_type" — on
`/en/withdrawals` specifically. First response was to restart the app
container and declare it fixed after one clean check; the user correctly
pushed back that this was a real recurring issue and asked for actual root
-cause investigation (checking the live process's real env, comparing
against working routes, correlating logs), not another restart-and-hope.
Root cause, confirmed by inspecting the compiled dev bundle directly
(`grep -c DATABASE_URL` in `.next/server/app/[locale]/*/page.js`):
`config.ts` validated `process.env` **eagerly at module-import time** and
threw synchronously on failure. `/withdrawals` was the first route where
`config.ts` became reachable from **both** the Server Component graph
(`page.tsx` → `interest-rate.ts`/`display.ts`) **and** the `"use server"`
Server Action graph (`actions.ts` → `withdrawal-requests.ts`) simultaneously
— confirmed 3 separate inlined copies of the env schema in that route's
compiled bundle vs. 0 for `/investments` and `/packages` (which never reach
`config.ts` from a `"use server"` file). Next.js's dev-mode webpack bundler
doesn't always dedupe a shared module across those two boundaries, so each
of the 3 instances ran its own independent top-level `envSchema.safeParse
(process.env)` on that route's compilation/re-instantiation — and one of
them intermittently hit a transient/incomplete `process.env` snapshot during
dev-mode's per-request module re-evaluation, throwing and crashing the whole
request instead of a caught, retryable error. Verified NOT the cause (ruled
out before finding the real one): `DATABASE_URL` was correctly set in
`docker-compose.yml`'s `environment:` block the entire time (confirmed via
`docker inspect`, `printenv`, and reading `/proc/<pid>/environ` for the
actual live `next-server` process, not just a fresh spawned check) — a
sibling `.env` file did have a *different* `DATABASE_URL` (`localhost`
instead of `postgres`), which looked suspicious but was a red herring: that
file is host-only (read by Prisma CLI/vitest/tsc run directly on Windows,
which cannot resolve the `postgres` Docker service hostname), never reaches
the container's `next dev` process at all, and briefly "fixing" it to match
compose broke host-side tooling immediately (confirmed: `prisma migrate
status` hung). Reverted that edit and instead left a comment in `.env`
explaining why the two values must stay different — see the comment above
`DATABASE_URL` there.
Rule: (1) **A module that validates external input (env, config) should
never throw synchronously at import/module-eval time in an app with
multiple possible bundle instantiations of that module** (dev-mode
multi-graph bundling, serverless cold starts, etc.) — validate lazily on
first real access and memoize the result, so a transient snapshot gap during
module load becomes a normal single re-check on next access, not a hard
crash. `config.ts` is now a lazy/memoized `Proxy` instead of an eager
top-level `throw`; this is the standing pattern for this project's env
config going forward. (2) Any future route that pulls the same lib file into
both a Server Component (`page.tsx`) and a `"use server"` Server Action file
simultaneously should be treated as a candidate for this exact class of dev
-mode bundle-duplication issue — check `.next/server/app/.../page.js` for
duplicate inlined copies of a shared module if a similarly intermittent,
route-specific crash appears again; don't assume it's a one-off. (3) When a
user reports an intermittent/recurring runtime error and a first restart
"fixes" it, that is not confirmation of the fix — it's confirmation the bug
is a race, which a restart temporarily avoids by luck of timing, not
resolves. Actually investigating (live process env inspection, compiled
-bundle diffing against a working route, repeated real requests including
concurrent bursts post-fix) is what distinguishes a real fix from a
coincidence, and multiple genuinely independent verification passes (20+
sequential requests, 15+ concurrent across bursts, both locales, one true
cold compile) is the right bar before calling an intermittent bug closed —
a single clean check after a restart proves nothing about whether the race
window was actually removed.

## 2026-08-18 — Phase 5 (session cookie, discovered while investigating SCRUM-61)
Mistake: `session.ts`'s `sessionCookieOptions` hardcoded `secure: true`
unconditionally, since Phase 1. This app is served over plain HTTP in local
dev (`http://localhost:3000`) — browsers refuse to persist a `Secure`
-flagged cookie set over a non-HTTPS connection (or drop it inconsistently
depending on browser/version), so the session cookie likely never persisted
reliably in dev at all. Confirmed directly: `curl -i` against `/api/auth/
login` showed `Set-Cookie: ... Secure; HttpOnly; SameSite=strict` on a plain
`http://` response. Discovered only while investigating an unrelated issue
(SCRUM-61's config.ts crash) when the user reported their manually-pasted
session cookie kept "expiring" — this had been silently causing friction
across every manual browser verification pass since Phase 3 (packages page,
investments page, and now withdrawals), not a new symptom, just never
previously traced to its actual cause. Every prior "session expired, please
log in again" moment in this project's manual-testing history was likely
this bug, not a real idle timeout (4h for users / 30m for admins per
`idleTimeoutForRole`).
Rule: cookie security flags must be environment-conditional, never
hardcoded for a dual dev(HTTP)/production(HTTPS) app. Fixed as `secure:
process.env.NODE_ENV === "production"` in `session.ts` — dev stays usable
over plain HTTP, production keeps the `Secure` flag as required. `HttpOnly`
and `SameSite=strict` are correct to keep hardcoded (they don't depend on
the transport being HTTPS). Verified via a fresh `curl -i` login showing
`Secure` no longer present in the dev `Set-Cookie` header, plus `session
.test.ts`'s existing 10 tests still passing and `tsc --noEmit` clean. Since
there's no `/login` UI yet (Phase 10 work), manual browser verification in
Phases 3-5 has relied entirely on cookie-pasting via DevTools after an API
login — any future manual-verification session hitting unexplained
"session expired" friction should check the actual `Set-Cookie` header
first (`curl -i` against the login endpoint) rather than assuming a normal
timeout, especially before Phase 10 ships a real login form and this class
of manual-auth friction becomes less common.

## 2026-08-18 — Phase 5 (SCRUM-62)
Mistake: the Phase 5 exit-test scratch script's `afterAll`-equivalent
cleanup deleted ledger rows via `where: { userId: { in: createdUserIds } } }`
— the exact same root cause already flagged **twice** in this file (Phase 2:
`reconciliation.test.ts`'s cleanup; Phase 2 again: a one-off verification
script). That filter only ever matches the real-user-side row of a
`postTransaction` pair; the paired `SYSTEM_EXTERNAL` row (`userId: null`)
from the same call is never scoped by any `userId` filter and was left
behind every time. Caught only because I insisted on re-running the full
suite one more time after the exit test "passed," rather than treating
29/29 exit-test assertions as sufficient — `reconciliation.test.ts` (a true
whole-database solvency check) failed with `SYSTEM_EXTERNAL: total user
balances=11400, ledger net=-20100, drift=-8700`. Diagnosed by finding every
`SYSTEM_EXTERNAL` ledger row with no surviving non-SYSTEM_EXTERNAL sibling
sharing its `idempotencyKey` — all 16 orphans traced directly to this
session's own exit-test funding/approval calls (`phase5-exit-fund:*`,
`withdrawal_request_approval:*`), confirming it was self-inflicted, not
latent pre-existing drift.
Rule: this is now the **third** time this exact mistake has happened in
this project (see the two Phase 2 entries above) — it is clearly not
sticking as a "remember it next time" fact, so treat it as a hard checklist
item, not a recalled lesson: **any script/test that calls
`postTransaction`/`adminCreditWalletB`/anything that writes a paired
SYSTEM_EXTERNAL ledger row MUST clean up by `idempotencyKey`, never by
`userId` alone — no exceptions, check this explicitly before writing any
new cleanup block, don't rely on remembering it.** Also: **"the exit test's
own assertions passed" is not the same bar as "the database is left
clean"** — after any exit test or manual scratch script that writes real
rows, run the full suite (specifically `reconciliation.test.ts`, the
whole-database check) as a separate, mandatory final step before declaring
the phase done, even when every scenario-specific assertion in the exit
test itself already passed. Repaired here via the standard
recompute-from-source principle: found every orphaned SYSTEM_EXTERNAL row
by idempotencyKey-sibling lookup (not by guessing which ones were mine) and
deleted exactly those, then re-verified via the real `runReconciliation()`
function (not just a hand-rolled balance check) before re-running the full
suite as final proof.

**Addendum, same day**: after the third occurrence above, the user asked
whether this could be made structurally harder to get wrong instead of
relying on remembering the rule — correctly pointing out that "remember
this" had already failed three times. Built `cleanupLedgerEntriesForUsers
(userIds: string[])` in a new `src/lib/test-helpers.ts`: takes the user-id
array every test already reliably tracks (that part was never the failure
point — only the ledger-row scoping was), looks up every ledger entry
belonging to those users, collects the distinct idempotencyKeys, deletes
every row sharing those keys (any userId, including null) in one call —
structurally includes SYSTEM_EXTERNAL siblings, no manual array-pushing
possible to forget. Considered and rejected a version taking an explicit
idempotencyKey array instead: several production functions
(`transferAtoB`, etc.) generate their key internally via `randomUUID()`, so
a test can't always know it in advance to collect it — same discipline gap
as the bug itself, just moved. Migrated the 8 test files that had the
risky `userId`-only pattern (`admin-credit`, `transfers`,
`withdrawal-requests`, `capital-release`, `saving-lots`, `reconciliation`,
`ledger-transaction`, `investments`) to the helper, removing their manual
`createdEntryIds` tracking entirely. Deliberately left
`daily-interest(-job).test.ts` alone — they scope cleanup by
`referenceType`/`referenceId` (investment id) instead, a different but
already-correct strategy for that pairing, not an instance of this bug
class.
Rule: **any new test or scratch script that creates users and writes
ledger entries for them must call `cleanupLedgerEntriesForUsers
(createdUserIds)` in its cleanup — never hand-write `ledgerEntry.deleteMany
({ where: { userId: ... } })` again.** This is now the standing, structural
answer to the recurring mistake, not just a documented pattern to remember
— use it from Phase 6 onward for every new test file and every future
scratch exit-test script.

## 2026-08-21 — Phase 7 (SCRUM-70)
Mistake: first draft of the BFS placement algorithm picked the sponsor's
weak leg ONCE (BV tie -> LEFT) and then BFS'd only within that chosen leg's
subtree for an open slot. On a fresh tree (BV starts at 0 for everyone,
always a tie), this meant the second referral spilled deeper into LEFT
(since LEFT's direct slot was already taken by the first referral) instead
of landing in the sponsor's still-empty RIGHT slot — failing the "first two
referrals become direct LEFT/RIGHT children" requirement outright, caught
immediately by the first test run, not by design review.
Rule: an open direct child slot at a node always wins over spilling deeper
into either leg, regardless of BV comparison — check "does this node have
an empty LEFT/RIGHT slot?" FIRST, and only fall back to
weak-leg-BV-then-BFS-within-that-leg once both direct slots are already
occupied. Confirmed explicitly with the user as a two-phase algorithm
(fast path: fill an open direct slot; slow path: real BV-based spillover)
rather than assuming a single "always compare BV" rule would naturally
produce the right first-two-children behavior — it doesn't, because a 0/0
tie under any single-leg-then-BFS design will always drift deeper down
one side instead of ever using the other direct slot.

## 2026-08-21 — Phase 7 (SCRUM-70)
Mistake: adding `binary_nodes` (with a `parent_id` self-FK and a `user_id`
FK to `users`, both `ON DELETE RESTRICT` per invariant #7) broke two
pre-existing test files' `afterAll` cleanup order
(`securityQuestion -> walletAccount -> user`) the moment those files'
sponsor-chain tests started creating binary_nodes rows as a side effect of
calling `registerWithSponsor` — `user.deleteMany` now fails on
`binary_nodes_user_id_fkey` since nothing deleted the node first. This
wasn't visible from the new test file alone; only running the FULL suite
surfaced it (matches the standing "run the whole suite, not just your new
file" rule already in this log, but for a schema-level FK this time, not a
ledger-idempotency-key issue).
Rule: adding any new table with an `ON DELETE RESTRICT` FK to `users` (or
any other table existing tests already clean up) requires auditing every
existing test file whose `afterAll` deletes rows from that referenced
table, not just writing correct cleanup for the new test file — a schema
change with RESTRICT semantics can retroactively break cleanup order in
code that hasn't been touched. Self-referencing FKs (like
`binary_nodes.parent_id`) also can't be cleaned up with a single flat
`deleteMany` scoped to a user-id list if any node in that set is still
some other node's parent — delete leaf nodes first, repeatedly, until none
remain (or delete children before parents if the hierarchy is known
upfront).

## 2026-08-22 — Phase 7 (SCRUM-71)
Mistake: none in the shipped code, but a real latent environment gap
surfaced while writing `binary-cycle.ts` — a pure function needing only
`config.TIMEZONE`, no DB access. `config.ts`'s env validation
(`envSchema.safeParse(process.env)`) had silently depended, since Phase 1,
on some OTHER module in the same import graph having already imported
`./prisma` first — `@prisma/client`'s runtime bundles `dotenv` and loads
`.env` as a side effect of `new PrismaClient()`; `config.ts` itself never
called anything to load `.env`. Every test file written so far happened to
import `./prisma` transitively (directly, or via a lib module that talks
to the DB), so this coupling never broke anything — until a file that
genuinely only needed config, not Prisma, didn't.
Rule: a config/env module must load its own `.env` explicitly
(`import "dotenv/config"` at the top of `config.ts`, `dotenv` was already a
project dependency) rather than relying on an unrelated module's import
side effect to populate `process.env` first. When a new pure-logic module
needs `config.*` but not `prisma`, and its standalone test file throws env
-validation errors that don't reproduce when run alongside other test
files, suspect this exact class of hidden import-order coupling before
assuming the test or the new module is wrong — verify by running the new
test file in complete isolation (`vitest run path/to/just-that-file.test.ts`),
since a full-suite run can mask the gap by accident of file ordering.

## 2026-08-22 — Phase 7 (SCRUM-71)
Mistake: none this time — caught proactively by applying the SCRUM-70
lesson rather than rediscovering it. Adding `bv_entries` (FK to
`investments.id`, `ON DELETE RESTRICT`) would have broken
`direct-commission.test.ts` and `users.test.ts` again, the same way
`binary_nodes` did in SCRUM-70 — both files create investments via
sponsored purchases (now generating bv_entries rows) and both call
`investment.deleteMany` in their `afterAll`.
Rule confirmed (not new, but worth re-noting since it worked): every time
a new table adds a RESTRICT FK to a table other tests already clean up,
explicitly grep for `<referencedModel>.deleteMany` across `*.test.ts`
BEFORE running the full suite, not after hitting the failure — this time
it was caught and fixed in the same pass as writing the new test file,
rather than needing a second full-suite run to discover it.
