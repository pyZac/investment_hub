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

## 2026-08-22 — Phase 8 (SCRUM-79)
Mistake: none in the shipped code, but a real environment hazard surfaced
and was initially under-verified. A background `vitest run` was still
executing when a second `vitest run` was started (foreground, after the
first appeared stalled) — both ran concurrently against the same shared
dev DB (no isolated test DB, per the standing Phase 2 lesson). The second
run alone came back clean, and this was initially reported to the user as
"confirmed benign, likely two overlapping processes" based only on that
retry passing — which the user correctly pushed back on, pointing out
this project's history of intermittent issues that turned out to be real
bugs (SCRUM-61). Deliberately reproducing it on demand (two `vitest run`
processes started 5s apart, full untruncated logs captured this time)
confirmed the real, nameable mechanism: (1) `commission_config`'s "at
most one active row" singleton — new for this ticket's historical-rate
test — got raced by both processes opening/closing the same row
concurrently, causing a genuine `findFirstOrThrow` empty-result error in
one process; (2) `phase-4-exit-test.test.ts`'s own documented hazard
(SCRUM-54: it assumes exclusive control of every `status: ACTIVE`
investment for its 90-day fabricated run) fired for real when both
processes ran it concurrently, producing an actual ledger
idempotency-key unique-constraint collision; (3) `reconciliation.test.ts`
(a true whole-DB check) then correctly caught the resulting real drift in
both runs. `vitest.config.ts`'s `fileParallelism: false` does NOT protect
against this — it only serializes files within one `vitest run` process,
not across two independent CLI invocations with no coordination between
them. The crash-mid-run left 2 orphaned `exit-test-*` users behind
(cleaned up via `cleanupLedgerEntriesForUsers` + the standard FK-safe
deletion order, per the existing crash-cleanup lesson), and
`reconciliation.test.ts` was re-run standalone afterward as proof of a
clean recovery.
Rule: **never run two `vitest run` invocations concurrently against this
shared dev DB, full stop** — if a run appears stalled/slow, wait for it
or check its process status, never start a second one "just to get an
answer faster." When a test run shows an unexpected failure and a second,
later run passes clean, "it passed on retry" is not evidence the first
failure was benign noise — that is exactly the shape of a race condition,
which a clean retry does nothing to explain away (this exact reasoning
gap is already flagged in the SCRUM-61 lesson above; it recurred here
because the failure looked environmental rather than code-shaped, which
made it feel safer to wave off without proof). If a "probably just noise"
explanation is offered, deliberately reproduce it before reporting it as
confirmed — capture full untruncated error output (background-task
output files can get truncated to a tail; redirect to a real log file
with `>` when deliberately reproducing something you intend to inspect
in full), and identify the actual mechanism by name, not just "it didn't
happen the second time."

## 2026-08-22 — Phase 8 (SCRUM-80)
Mistake: a real off-by-one in test date literals (not the engine code,
which was correct throughout). This project's established convention for
stamping "Saturday 00:00 Asia/Dubai" for a given calendar Saturday date D
is `(D-1)T20:00:00.000Z` — Dubai is a fixed UTC+4 offset, so Dubai
midnight is 20:00 UTC the PRIOR calendar day. `binary-cycle-close.test.ts`
already established this correctly (`WEEK_START = "2026-08-21T20:00:00
.000Z"` for calendar Saturday 2026-08-22, with an explicit comment saying
so). `binary-cycle-job.test.ts`'s first draft instead used the calendar
Saturday's own date directly (e.g. `"2026-08-29T20:00:00.000Z"` for
calendar Sat 08-29), which is actually Dubai SUNDAY 08-30 00:00 — a full
week off from what the test intended, silently shifting every computed
"unprocessed week" by one. This did not throw or look obviously wrong; it
produced a different but internally-consistent set of weeks, so the
symptom was a confusing assertion mismatch (`expected [...2 weeks] to
equal [...3 weeks]`), not a crash pointing at the real cause. Root-caused
by writing a tiny scratch script calling `saturdayWeekStart` directly and
comparing its output against `Intl.DateTimeFormat`'s real Dubai-local
weekday for the same instant, rather than guessing from the assertion
diff alone.
Rule: **any new test file dealing with Saturday-00:00-Dubai week
boundaries must copy the `(calendar-Saturday-date − 1)T20:00:00.000Z`
convention verbatim from an existing correct example
(binary-cycle-close.test.ts's `WEEK_START`) — never re-derive it from
"what date is Saturday" by hand.** When a weekly-cycle test's assertion
fails with a plausible-looking-but-wrong value (not a crash, not an
obviously nonsensical number), suspect this exact class of timezone
-stamping error before assuming the engine logic is wrong — verify by
calling the actual date-boundary helper (`saturdayWeekStart`, or
whichever is relevant) directly against a real `Intl.DateTimeFormat`
weekday check, not by staring at the ISO string and assuming it's
self-evidently correct.

## 2026-08-22 — Phase 8 (SCRUM-81)
Mistake: ran a live-verification scratch script inside the app container
(manually building a real tree/purchases/cycle to check the new binary
-panel UI against the real dev DB) WHILE a background full-suite `vitest
run` was still executing against the same shared dev DB — the exact class
of hazard the SCRUM-79 lesson names, just via a scratch script instead of
a second `vitest run`. Symptom: a user I created and closed exactly one
cycle for via the script ended up with 4 `binary_cycles` rows spanning
several weeks I never asked for, and the "qualified" scenario read back
as unqualified. Root cause not fully traced (the concurrent test run had
already finished and its own data was cleaned up by the time this was
investigated, so the exact write path couldn't be replayed after the
fact) — but isolating the two (waiting for the suite to finish, then
re-running the identical script alone) reproduced exactly the expected
single row per user with no anomalies, which is strong enough evidence of
concurrent contamination to act on, even without a fully named mechanism.
Also found and fixed a real script bug in the same pass, independent of
the concurrency issue: the "qualified" demo scenario funded/purchased for
the two CHILDREN but never gave the SPONSOR their own active investment
— qualification requires an active investment for the sponsor
themselves, not just both legs active, so the first attempt legitimately
came back `no_active_investment` regardless of the concurrency problem.
Rule: **the SCRUM-79 "never run two vitest processes concurrently" rule
generalizes to "never run ANY script that writes to the shared dev DB
while a background test suite is executing against it"** — a manual
verification script is not exempt just because it isn't itself vitest.
Before running any DB-writing scratch script, check `tasklist | grep
node.exe` (or equivalent) for other active Node processes, not just
other vitest invocations by name. When cleanup is needed after a
concurrency-contaminated run, don't try to reverse-engineer exactly which
foreign process wrote what — since the mechanism is often untraceable
after the fact, just fully clean the contaminated scope and redo the
verification in true isolation, then treat a clean isolated re-run as
sufficient proof the contamination theory was right (matches the general
principle already established: a race that only manifests under overlap
and disappears under isolation doesn't need every step of its mechanism
named to be believed, once it's been deliberately isolated and confirmed
to disappear — the SCRUM-79 lesson's bar for "prove it, don't just retry"
was met here by isolating and reproducing clean, since the original
contaminating process could no longer be inspected after the fact).

## 2026-08-22 — Phase 9 (SCRUM-85)
Mistake: none in the shipped code — caught by a test the ticket itself
specified before implementation was declared done. `evaluateRankForUser`'s
first draft skipped any rank already in `rank_awards` and granted the
single highest newly-qualified rank, which correctly handled the exit
test's own scenario. But the ticket's own required test case ("repeating
the same qualifying performance in a later month grants nothing") exposed
a real gap: a LOWER rank crossed the same month as a granted HIGHER rank
(e.g. Investor crossed alongside Partner, but never itself given a
rank_awards row since only the highest is paid) was never recorded
anywhere — so it stayed silently eligible, and a later month's identical
performance would grant it late, effectively paying a "lower rank in the
same month" after all, contradicting the rule's own wording.
Rule: "only the highest is paid" implies the lower ranks crossed that
month are DECIDED AGAINST, not merely "not paid this time" — a system
that tracks permanence only for what WAS granted (not also for what was
considered-and-lost) will let a forfeited rank resurface later under
repeat performance. Any "grant the best of several qualifying options,
permanently" design needs a place to record the ones that lost, not just
the one that won — added a dedicated `RankForfeit` table (kept separate
from `RankAward` so the awards table stays a clean audit trail of real
rewards, confirmed with Zac before adding the second table rather than
conflating the two). Caught here specifically because the ticket's
required test list included the "repeat performance" case up front,
before implementation — a reminder that the test list in a ticket's own
instructions often encodes exactly the edge case a first-draft
implementation will miss; don't treat "the obvious cases pass" as done
until every explicitly-requested test is actually written and green.

## 2026-09-03 — Phase 10 (SCRUM-92)
Mistake: none in the shipped lib code, but a long, real debugging session
building the daily-profit Recharts area chart, worth recording in full since
it cost hours and the root causes are non-obvious and will recur.

Three separate, stacked issues, each masking the next:
1. **`var(--color-*)` in SVG presentation attributes doesn't reliably
   resolve.** `stopColor="var(--color-chart-1)"`, `stroke="var(--color-border)"`
   etc. passed as plain React/SVG attribute props (not inside a `style={}`
   object) rendered a structurally-correct path with completely invisible
   color — confirmed by reading the DOM directly (`getAttribute('stop-color')`
   literally returned the string `"var(--color-chart-1)"`, unresolved).
   Fix: resolve the actual hex value once (matching `globals.css`'s token) and
   pass that instead of a `var()` reference, anywhere a value becomes an SVG
   presentation attribute rather than a CSS `style` property. This applies to
   every future Recharts/D3/inline-SVG component in this project, not just
   this chart.
2. **Recharts 3.10's default `Area` shape (`AreaRevealShape`) applies an
   entrance-animation clip-path even when the surrounding dev-server state is
   stale**, and with a `connectNulls={false}` multi-segment series (this
   chart's Friday gaps) that clip's width computation only covered the first
   segment, silently truncating every later segment to nothing. Passing a
   custom `shape` prop that renders a plain `Curve` (bypassing
   `AreaRevealShape` entirely) is the robust fix — `isAnimationActive={false}`
   alone does NOT prevent this, confirmed by reading Recharts' own source
   (`cartesian/AreaRevealShape.js`, `cartesian/Area.js`).
3. **Recharts' `<Tooltip>` sets its wrapper's `visibility: hidden` whenever
   its own internal payload is empty for the hovered x-position**
   (`TooltipBoundingBox.js`: `visibility: ... props.hasPayload ? 'visible' :
   'hidden'`), regardless of what a custom `content` render function returns.
   A `null`-valued point (this chart's Friday gap, under `connectNulls=false`)
   has no payload, so the tooltip box was invisible on every Friday even
   though the custom tooltip component's fallback logic computed the correct
   "Friday — no accrual" content. Fix: add a second, fully invisible
   (`stroke="none" fill="none"`) `Area` series with a `hitAmount` field that
   substitutes `0` for `null` — this gives Recharts a non-null point to
   consider "has payload" at every x-position without rendering anything
   visible, while the real visible series and the tooltip's own content logic
   both still read the true `amount`/`isFriday` fields. This is the standard
   pattern for "make every x-position hoverable in a chart with real data
   gaps" in Recharts and should be reused for any future gapped chart in this
   project, not rediscovered.

Also re-confirmed (third occurrence of this exact issue, first two were in
earlier phases per the SCRUM-61/session-cookie entries above): after any code
change to a Server/Client Component, if a freshly-compiled route renders
**stale JSX from before the edit** (extra/missing sections, an old prop
default) with no error logged and `tsc --noEmit` clean, this is the known
dev-mode stale-compile quirk — `docker compose restart app`, wait for
readiness, then re-warm the specific route with one request before trusting
any render output. Do not spend time debugging application logic against a
stale render — restart first, re-verify, and only treat the bug as real if it
reproduces after a clean restart. This cost real time in this session because
each of the three real Recharts bugs above was independently reinforced or
obscured by this same stale-compile pattern firing in between fix attempts.

Rule going forward: for any new Recharts (or other SVG charting) component in
this project — (1) never pass a `var(--color-*)` CSS reference as a plain SVG
attribute prop, always resolve to a literal value; (2) override `shape` with
a plain non-animated renderer for any Area/Line with real data gaps, don't
rely on `isAnimationActive={false}` alone; (3) if the chart has genuine gaps
in the data (not just sparse data), add an invisible hit-testing series so
every x-position remains hoverable; (4) after any chart-component edit,
restart the dev server and re-warm the route before judging whether a visual
result reflects the new code.

## 2026-09-04 — Phase 10 (SCRUM-92 follow-up, found while starting SCRUM-93)
Mistake: `buildDailyProfitSeries` (`daily-profit-series.ts`) keyed its walked
date range with `cursor.toISOString().slice(0, 10)` — the UTC date — while
`getDailyInterestHistoryA` (`wallets.ts`) keys its history map with
`dubaiDayKey`, the actual Dubai business day. These only coincidentally
matched in every existing test because every test fixture used
`T08:00:00.000Z` (noon Dubai) instants, which happen to have the same UTC and
Dubai calendar date. In real usage, `now = new Date()` lands at an arbitrary
wall-clock time, and whenever its UTC date differs from its Dubai date (any
time before 04:00 UTC, i.e. before 08:00 Dubai), every key this function
produced was silently off, so a real user's actually-credited interest never
matched any point in the chart's own generated series — the chart rendered
as if the user had zero history, even though `getDailyInterestHistoryA`
returned the correct data one level up. Caught only because a live check
against a real seeded user (not a test) showed the chart looking empty
despite a non-zero "today's profit" figure on the same page — the two
numbers visibly disagreeing is what made this noticeable, not a test.
## 2026-09-04 — Phase 10 (SCRUM-95)
Mistake #1: none in the newly-written code, but a real latent bug was caught
in passing — `Button` (`src/components/ui/button.tsx`, a Base UI `Button`
primitive) rendered with `render={<Link href="..." />}` (the established
pattern for a link styled as a button, e.g. `investment-list.tsx`'s "Browse
packages" button from Phase 3) throws a console warning at runtime: Base UI's
`Button` defaults `nativeButton` to `true`, which asserts the rendered element
really is a `<button>` — but `Link` (from `@/i18n/navigation`) renders an
`<a>`. This never surfaced before because nothing had actually loaded that
page in a real browser and inspected the console (per the "check console
--errors" verification habit) until SCRUM-95's live-browser check of the new
dashboard "View full tree" link caught it.
Rule: any `Button` rendered with `render={<Link ... />}` (or any non-`<button>`
element) must also pass `nativeButton={false}`, or Base UI logs a real
accessibility-semantics warning on every render. Fixed in both the new
SCRUM-95 usage and the pre-existing `investment-list.tsx` one found during
this pass. Add this to the standing checklist for any future `Button` +
`render` combination that isn't a real `<button>`.

Mistake #2 (real pre-existing bug, not introduced by this ticket, but only
caught by this ticket's live-Arabic-screenshot requirement): the binary tree's
`scaleX(-1)` RTL-mirroring technique (`binary-tree-view.tsx`) set
`translate.x = dimensions.width - 40` for the mirrored (Arabic) case, vs `40`
for LTR. This looked like the obviously-correct "mirror the anchor point too"
choice, but `scaleX(-1)` on the wrapping div uses the default transform-origin
(50% 50%, the div's own center) — center-pivot mirroring already maps every
local x to `width - x` on screen, so it does NOT need (or want) a
mirrored-specific translate value; using the *same* `translate.x = 40` for
both cases was actually correct, because the center-pivot mirror handles the
visual flip on its own. With the buggy `width - 40` value, the root (the only
node whose local x was near `width`) happened to land back near the visual
left edge by coincidence and looked plausible in a quick check — but every
deeper generation's local x (root's x plus rightward growth per level) pushed
well past `width/2`, which mirrors to a *negative*, off-canvas screen x. The
practical symptom: in Arabic, only the root node was ever visible; every
child/grandchild silently vanished off the left edge of the tree canvas. This
had shipped in Phase 7/8 and was never caught because no prior ticket did a
live Arabic screenshot of a tree with more than one generation — the Phase 7
exit test's own RTL check evidently only confirmed the root rendered, not a
multi-level tree's full layout.
Rule: **for any `scaleX(-1)`-based RTL mirror wrapping absolutely-positioned
or transform-translated children, verify with a live multi-level/multi-node
screenshot, not just "does the root/first item appear."** A mirror pivot bug
often still shows *something* on screen (making a quick glance look fine)
while silently clipping everything past a certain distance from the pivot —
the failure is invisible unless the content actually extends far enough from
the anchor to cross the wrong pivot's boundary. When debugging a "half the
tree/list is invisible in RTL only" symptom, check the actual computed
`transform` and `transform-origin` (via `getBoundingClientRect()`/
`getAttribute("style")` in a real browser, not by reading the JSX and
assuming the math is right) before touching mirroring logic — the fix here
was a one-line `translate.x` correction once the actual pivot math was traced
through by hand.

## 2026-09-05 — Phase 10 (SCRUM-97)
Mistake: none in the newly-written SCRUM-97 code, but a real pre-existing bug
blocked its live-verification requirement and had to be fixed first.
`display.ts`'s `formatDate(value, locale)` read `config.TIMEZONE` (the
env-validated lazy Proxy from `config.ts`) to pass as `Intl.DateTimeFormat`'s
`timeZone` option. `formatDate` is called directly from FOUR already-shipped
`"use client"` components — `referrals-list.tsx`, `commission-history-list.tsx`
(both Phase 6), `investment-list.tsx` (Phase 3), and `b-exit-status-list.tsx`
(Phase 5) — none of which had ever been exercised via a real, full
login-through-navigation browser flow before (per this project's own history:
Phases 3-5 relied on cookie-pasting per the SCRUM-61 lesson, and no ticket
before SCRUM-97 did a genuine live click-through of `/referrals` specifically
after Phase 6 shipped it). `config` reading `process.env` inside a client
("app-pages-browser") webpack bundle always fails — server env vars
(`DATABASE_URL`, `SEED_ADMIN_EMAIL`, etc.) never reach the browser, so
`envSchema.safeParse(process.env)` fails there every single time, not
intermittently. This is a DIFFERENT bug class from the SCRUM-61
RSC/Server-Action module-duplication race (both bugs happen to throw the same
"Invalid environment configuration" message from the same `loadConfig()`
call site, which made this one look like a recurrence of that already-known,
already-"fixed" issue at first) — confirmed distinct by reading the actual
browser stack trace (`page.on("pageerror")` with `err.stack`, not just
`err.message`), which pointed at `webpack-internal:///(app-pages-browser)/
./src/lib/config.ts`, a client bundle, not an `(rsc)`/`(ssr)` duplicate
racing on first access.
Rule: (1) **when an "Invalid environment configuration" error recurs, always
read the full stack trace before assuming it's the known SCRUM-61 race** —
check whether the throwing bundle is `(app-pages-browser)` (a real,
deterministic client-side bug: something client-reachable imports server-only
`config`) vs `(rsc)`/`(ssr)` duplicates (the already-mitigated lazy-load
race). The fix and the correct diagnosis are completely different depending
on which one it is. (2) **`config.ts` (or any server-only env-validated
module) must never be imported, even transitively, from a function called by
a `"use client"` component** — `formatDate` didn't actually need dynamic env
config at all: `config.TIMEZONE`'s own schema is `z.literal("Asia/Dubai")`,
a value that can never be anything else, so the fix was to hardcode the
literal directly in `formatDate` and drop the `config` import from
`display.ts` entirely, not to make `config` "more client-safe." Any future
shared helper called from both server and client components should be
checked for transitive server-only imports (env config, Prisma, anything
reading `process.env` beyond `NODE_ENV`) before being reused client-side.
(3) This bug had been silently live in four shipped pages since Phase 3 —
it was invisible because no ticket's manual verification had done a true
end-to-end authenticated click-through (real login -> navigate -> render)
of any of those four pages until SCRUM-97's live-browser verification step
actually did. Reinforces the existing "manually exercising against the real
app is not optional" lesson (SCRUM-52) for one more class of bug: a
client-only crash that unit tests (which run in Node, not a browser, and
never exercise the `(app-pages-browser)` bundle) can never catch on their own.

**Follow-up sweep (same day, before starting SCRUM-98)**: at the user's
request, checked the rest of the codebase for other dormant instances of
this same bug class (a `"use client"` component transitively importing
`config.ts` or any other `process.env`-reading module) before continuing.
Method: listed all 17 `"use client"` files, checked each one's `@/lib/*`
imports, and traced every consumer of the four modules that still import
`config.ts` post-fix (`rank.ts`, `binary-cycle.ts`, `withdrawal-requests.ts`,
`interest-rate.ts`) plus every project-wide `process.env` usage
(`config.ts`, `session.ts`'s `NODE_ENV` check — safe, Next.js always inlines
`NODE_ENV` even in client bundles — `prisma.ts`, `worker/index.ts` — both
server-only by construction). Found two `"use client"` files
(`daily-profit-chart.tsx`, `binary-tree/binary-panel.tsx`) that import from
config-adjacent modules (`daily-profit-series.ts`, `binary-cycle.ts`,
`binary-tree.ts`) but only via `import type` — type-only imports are erased
entirely at compile time, so they pull in zero runtime code and can't
reproduce this bug. No other instance found. Confirmed `src/components/
binary-panel.tsx` (the SCRUM-94 dashboard rank/binary panel, easy to
confuse by name with the older `binary-tree/binary-panel.tsx`) is a Server
Component, not client, despite the naming collision.
Rule: **a full-codebase sweep for "other instances of a bug just found" is
worth the few minutes it costs, and `import type` vs a value import is the
key distinction when auditing "does this client component transitively pull
in server-only code"** — grep for `from "@/lib/X"` without first checking
whether it's `import type` will produce false positives. This sweep is now
done as of 2026-09-06; a future session doesn't need to redo it from
scratch, only re-check anything genuinely new added since.

Rule: this project already has the `startOfDubaiDay`/`dubaiDayKey` helpers in
`wallets.ts` for exactly this bucketing; they've now been extracted into
`src/lib/business-day.ts` as the single shared implementation. **Any new
function that buckets a `createdAt` timestamp or walks a date range in Dubai
-business-day terms must import from `business-day.ts`, never
re-derive `cursor.toISOString().slice(0, 10)` or similar UTC-date logic
inline** — this is now the second independent time this exact mistake
happened in this project (see the `getTodayInterestCreditA`/
`getDailyInterestHistoryA` `dubaiDayKey` comment for the first). Also: **a
test suite built entirely from midnight/noon-aligned fixture instants can
hide a real timezone-boundary bug indefinitely** — at least one test for any
Dubai-day-bucketing function should use a fixture instant deliberately near
the UTC/Dubai day-boundary edge (e.g. 21:00–04:00 UTC), not just clean noon
-Dubai instants, specifically because that's the range where a UTC-vs-Dubai
mismatch actually manifests.

## 2026-09-06 — Phase 10 (SCRUM-99)
Mistake: none in the newly-designed backend logic, but a real cross-cutting
RTL bug was found (and fixed project-wide, not just in the new page) during
this ticket's live Arabic verification. A literal `+`/`−` sign concatenated
directly before a `tabular-nums` amount (e.g. `{"+"}{"40.00"}` or
`+${formatAmount(...)}`) renders correctly in English but gets visually
reordered by the browser's Unicode bidi algorithm inside an RTL-context
element — `+40.00` displays as `40.00+` (sign trailing the digits) in
Arabic, silently flipping the sign's visual position without changing the
underlying text content or throwing any error. This is invisible to a
translation-only review (the string itself is fine) and only shows up on an
actual rendered `/ar` screenshot, which is exactly why it went undiscovered
in three earlier phases (`wallet-card.tsx`'s "Today's profit" footer since
SCRUM-92, `commission-history-list.tsx`'s Direct Commission amounts since
Phase 6, `daily-profit-chart.tsx`'s tooltip since SCRUM-92) despite this
project's own bilingual-rtl skill mandating an Arabic visual walkthrough for
every UI ticket — none of those three prior verifications happened to
zoom in on / scrutinize the exact sign-digit ordering closely enough to
notice a one-character transposition.
Rule: **any literal sign/currency symbol placed directly adjacent to a
`tabular-nums`/numeric value in JSX must have `dir="ltr"` on the immediate
wrapping element**, not just rely on the parent page's `dir="rtl"` sorting
itself out — numbers and their adjacent symbols are a single semantic unit
that must not be bidi-reordered independently of each other. One existing
precedent for this pattern already existed in this codebase
(`binary-tree-view.tsx`'s counter-flip wrapper, for a different reason —
mirroring — but same `dir="ltr"` mechanism) before this ticket, but it was
never generalized as a rule for the plain sign+amount case elsewhere. Fixed
in all 4 instances found via a project-wide grep for `tabular-nums
text-success` (the shared styling fingerprint of every affected span) —
`transaction-list.tsx` (new), `wallet-card.tsx`, `commission-history-list.tsx`,
`daily-profit-chart.tsx`. Going forward, add `dir="ltr"` to any new
sign-prefixed or currency-prefixed numeric display from the start, and when
reviewing a rendered `/ar` screenshot, explicitly check that every visible
`+`/`−`/currency-symbol sits on the correct side of its digits, not just
that the digits themselves are Western numerals — this is a distinct check
from the numeral-forcing rule already established for `formatDate`.

## 2026-09-06 — Phase 10 (SCRUM-99), a new variant of the SCRUM-54/79 hazard class
Mistake: SCRUM-99's live-verification demo script (`scrum99-demo-setup.ts`)
called the REAL `runDailyInterestCatchUp(now)` — not a fabricated/isolated
call — to make a demo user's Daily Interest entries genuine rather than
hand-inserted. This wrote a real `job_runs` row for today's actual calendar
date under the single global `(job_type, period_key)` key the real scheduler
also uses. Running the full suite shortly after, `phase-4-exit-test.test.ts`
(the 90-fabricated-day exit test, whose fabricated window happens to include
every real calendar date from `windowStart` through `windowEnd`, including
`now`) failed a balance assertion — its own day-by-day
`runDailyInterestCatchUp(cursor)` loop silently no-op'd for the one date
that collided with my already-COMPLETED real row (postTransaction/job_runs
idempotency correctly prevented double-processing, which is exactly right
in production — but that same correctness is what broke a test that assumed
it owned every period_key in its fabricated window). The test's own
`afterAll` only deletes period_keys it itself created and tracked
(`createdJobRunPeriodKeys`), so a pre-existing external row for the same key
is invisible to its cleanup and never even attributed back to "something
else wrote this." Confirmed the mechanism (not just observed a retry
passing): traced `periodKeyFor()`'s key derivation, confirmed it's a
single global key with no test/run-scoping, then re-ran the exact same test
file in isolation after clearing the polluting row — clean pass, then
re-ran the FULL suite after also cleaning up the demo users — 43/43 files
clean, confirming the fix rather than just hoping the second run was luckier.
Rule: **this is the same root class as the SCRUM-54 (exit test vs.
pre-existing real investments) and SCRUM-79 (concurrent vitest processes)
hazards — "a function that operates on shared global state
(`runDailyInterestCatchUp`, or anything keyed by `job_type`+calendar date
rather than a test-scoped id) is dangerous to call for real outside of a
test file's own tracked-and-cleaned scope, even from an ad-hoc manual
verification script, not just from another automated test process.**
Going forward: any manual/scratch demo script that needs realistic Daily
Interest entries should prefer directly seeding the `ledger_entries` rows
(same pattern already used for MRV/rank/binary-cycle demo data in earlier
Phase 10 tickets) rather than invoking the real scheduler entry point,
specifically because that entry point's idempotency key is global and
calendar-scoped, unlike per-user seed helpers. If a real scheduler call is
genuinely needed for a demo, run the full test suite immediately afterward
(before doing anything else) to catch a `job_runs`/global-state collision
early, and always clean up demo data before considering a session's test
run "final."

## 2026-09-08/09 — Phase 10 UX-gap session — KNOWN PERMANENT DISCREPANCY, do not try to fix
Mistake: ran multiple `vitest run` invocations concurrently against the
shared dev DB in the same session — the exact SCRUM-79/SCRUM-99 hazard class,
just triggered by losing track of which `docker compose exec` background
Bash calls had actually exited versus still running in the container (the
Bash tool's own "moved to background" timeout does not mean the underlying
container process died — checked via `/proc/[pid]/cmdline` and found two
full vitest trees plus a stray worker alive simultaneously well after their
originating shell commands had timed out on the host side). This produced a
real, permanent artifact: a `daily_interest` ledger-entry pair for test-
fixture user `cmtsra6kh006wo58llcuk8ysk` (email
`rankpayoutjob-fail-a-...@test.local`, from `rank.test.ts`'s
"payout job fails at wallet A" scenario, interrupted mid-run by the
concurrent-run collision) whose `WalletAccount` row for wallet A does not
exist — the ledger CREDIT/SYSTEM_EXTERNAL DEBIT pair itself is fully valid
and correctly double-paired (idempotency key
`daily_interest:cmtsra6kh006wo58llcuk8ysk:cmtsra6mg007go58ltjeixmjk:2026-09-26`,
amount 27.33841602 each side), but with no wallet to belong to, it reads as
a permanent -27.33841602 drift in `runReconciliation()`'s SYSTEM_EXTERNAL
global-solvency check.
First reflex was wrong and got corrected by the user: attempted to delete
the two orphaned ledger rows by `idempotencyKey` (the standard repair
pattern from every earlier orphan-cleanup entry in this file) — blocked at
the DB level by `ledger_entries`' own append-only trigger, which is invariant
#2 working exactly as designed, not an obstacle to route around. The
correct diagnosis, once delete was impossible: this is not "harmless test
leftover to sweep away," it is **permanent real ledger history** by the
very invariant that makes ledger data trustworthy — the actual bug is
upstream (something let a wallet get removed, or never got created, while
ledger entries referencing it still got posted; root cause not yet isolated,
most likely `rank.test.ts`'s own crash-cleanup path colliding with the
concurrent run rather than a genuine app-code gap). The user then asked to
make `runReconciliation()` gracefully skip entries with no matching wallet —
also correctly rejected: that function's own doc comment says drift is
"a potential tampering signal, not merely a bug signal... throws loudly
rather than logging silently" — silencing exactly the "wallet vanished but
its ledger history didn't" case would blind the one check built to catch
that class of corruption in production, not just in this dev accident.
Rule: (1) **never trust a Bash tool "timeout, moved to background" message
as proof the underlying command stopped** — for anything running inside a
long-lived container (this project's `docker compose exec` pattern), check
`/proc/[pid]/cmdline` inside the container itself before starting a second
`vitest run`, every time, not just when something already looks wrong.
(2) **`ledger_entries` being literally undeletable (DB trigger, not just
convention) means any future orphan discovered here needs a different
disposition than the delete-by-idempotencyKey pattern used everywhere
else in this file** — that pattern still applies to every OTHER
undeletable-in-practice-but-not-actually-blocked case (Phase 2/5/8 entries
above), but this project's ledger table specifically cannot be swept clean
by a script once a bad pair lands, ever. (3) This specific discrepancy
(user `cmtsra6kh006wo58llcuk8ysk`, idempotency key
`daily_interest:cmtsra6kh006wo58llcuk8ysk:cmtsra6mg007go58ltjeixmjk:2026-09-26`,
-27.33841602 SYSTEM_EXTERNAL drift) is now a **permanent, accepted, explained
exception** in this dev DB — any future session running
`reconciliation.test.ts` or `runReconciliation()` directly and seeing
exactly this drift amount/user/key should recognize it immediately as this
already-documented artifact, not re-investigate it or attempt to "fix" it
again. It is not real user money and does not indicate a live bug in
current app code.

## 2026-09-11 — Phase 11 (SCRUM-108)
Mistake: `getCurrentRate()` (new admin-facing function for the interest
-rate management screen) queried `interest_rate_config` with
`where: { effectiveTo: null }` to find "the current rate" — this looks
correct and matches how `dailyRate()`'s own storage convention is
described ("the open-ended row is the active one"), but is wrong the
moment a FUTURE-dated rate change has been scheduled. `setInterestRate`
closes the old row's `effectiveTo` to the NEW row's `effectiveFrom`
(so the old row's `effectiveTo` is no longer null) and creates the new
row with `effectiveTo: null` — but the new row's `effectiveFrom` can be
weeks away. For that whole window, `effectiveTo: null` matches the NEW
(not-yet-active) row, not the OLD (still genuinely in effect) one, so
`getCurrentRate()` would show an admin a rate that hasn't taken effect
yet as if it were live today. Caught only by manual end-to-end
verification (create a future-dated rate, then check what "current"
reports) — the unit tests I wrote first didn't catch it because they
tested `setInterestRate`'s own row mutations directly, never called
`getCurrentRate()` after scheduling a future change.
Rule: **"the row with effectiveTo: null" and "the row active right now"
are NOT the same claim** for any table using this open-ended-row
versioning pattern, the instant the table supports scheduling a change
for a future date (not just "effective immediately"). Any "get current
X" query against such a table must use the same date-bounded lookup as
the table's own read-side consumer (here, `dailyRate()`'s
`effectiveFrom: { lte: forDate }, OR: [{effectiveTo: null}, {effectiveTo:
{gt: forDate}}]`), never the shortcut `effectiveTo: null` alone — and
must take `forDate` as an explicit parameter (invariant #4) rather than
implicitly meaning "now," so it can be tested at a specific instant
before/after a scheduled change lands. Added a regression test in
`rate-config.test.ts` that schedules a future rate then asserts
`getCurrentRate(admin, now)` still returns the OLD row and
`getCurrentRate(admin, future)` returns the NEW one. Any future
versioned-config screen with admin-schedulable future-dated changes
(commission config, rank config, if they ever get the same "effective
from a future date" capability) should apply this same rule from the
start, not discover it via manual testing.

## 2026-09-11 — Phase 11 (SCRUM-109)
Mistake: none in shipped code, but the ticket's own premise was wrong in
three ways, all caught by reading the real schema/engine code before
writing anything, per CLAUDE.md's "stop and ask rather than guessing" rule
— worth logging since a ticket's stated premise isn't automatically ground
truth. (1) The ticket said to reuse "existing commission_config versioned
write functions from Phase 5" — none existed; Phase 5/6 only ever wrote
this table via raw `prisma.commissionConfig.update/create/delete` inside
test files, which is exactly the pattern invariant #2/#6 forbid for real
admin code. Built `commission-config.ts` from scratch this ticket, mirroring
`rate-config.ts`'s SCRUM-108 pattern exactly (closes old open-ended row,
inserts new row, one transaction, getCurrent* uses the date-bounded lookup,
never the effectiveTo:null shortcut). (2) The ticket asked for
carry-forward expiry "in weeks" but the real column
(binaryCarryForwardExpiryMonths) and mlm_rules_log.md ("default 6 months")
are both in months — kept months, ticket wording was a slip. (3) The
ticket asked for "Direct rate + 5/3 split that must sum to 100%," but the
schema's directRate field was unused by any engine code — only
directCommissionSplit/directSavingSplit (read as independent % of
investment amount, seeded 5/3) were ever read by direct-commission.ts.
Confirmed with the user to reinterpret the two split fields as percentages
OF directRate that must sum to 100 (seeded 62.5/37.5 of directRate=8, same
effective 5%/3% payout) — this required a real formula change in
direct-commission.ts (`amount * directRate/100 * split/100`, was `amount *
split/100`) plus a one-time data migration converting the existing row's
split values, not just new UI. Confirmed the effective payout was
unchanged by re-running direct-commission.test.ts's existing
hardcoded-amount assertions (500/300 on a 10000 investment) unmodified —
they still passed, proving the migration + formula change together
preserve real payout amounts exactly.
## 2026-09-11 — Phase 11 (SCRUM-113)
Mistake: first draft of `getSolvencyOverview`'s "total liabilities"
formula summed wallet balances PLUS `Investment.amount` (unreleased
principal) PLUS `SavingLot.amount` (unreleased saving), reading
build_plan.md Part 5's wording ("wallet balances + locked capital +
pending saving lots") as three ADDITIVE pools. Both additions were real
double-counting bugs: tracing `purchasePackage` shows it credits the full
principal directly into the buyer's Wallet A balance at purchase time
(capital release later is literally "A -> B" per
wallet_interest_audit_rules_log.md's own words — the same money moving,
not new money surfacing), and tracing `direct-commission.ts` shows the 3%
saving split simultaneously credits a real SAVING wallet balance AND
creates a `SavingLot` row for the identical amount — the row is metadata
tracking the unlock date, the wallet balance IS the money. Caught
immediately (never shipped) because the ticket's own required test —
"total liabilities matches [...], verified against a real purchase" —
forced writing a before/after delta test with a hand-computed expected
value; the first run's actual delta (21100, then 11100) didn't match the
naive expected value (10800) on the first two attempts, which is what
triggered actually tracing the money through `investments.ts`/
`direct-commission.ts`/`capital-release.ts` instead of trusting the
docs-derived formula.
Rule: **`build_plan.md`'s Part 5 wording for this dashboard is
under-specified/ambiguous about whether "locked capital"/"pending saving
lots" are separate ledger locations or just movement-restriction labels
on money already inside a wallet balance — they are the latter.** Any
future aggregation feature that sums money across multiple tables
(wallets + investments + saving_lots + anything similar) must trace at
least one real write path for each table before trusting a docs
paragraph's list of "components to sum" — a table existing and holding a
plausible-sounding amount field does not mean summing it is additive
with other tables; it may already be reflected there via a paired wallet
credit. The delta-based test pattern (before/after around one real,
traceable write) is what caught this — an absolute-total test against
the shared dev DB would not have isolated the bug as cleanly, and a test
using only hand-inserted/mocked rows would have "passed" against the
wrong formula by construction. Prefer delta tests around one real
end-to-end write (a real purchase, a real admin credit call) over either
extreme whenever a new aggregation function is being verified for the
first time.

Rule: when a ticket describes a "reuse existing X" or "field Y already
supports Z" premise, verify it against the actual schema/lib code before
implementing — grepping for the claimed write function or checking whether
a named schema field is actually read anywhere is cheap compared to
building UI against a function or semantic that doesn't exist. When a
ticket's business-rule wording conflicts with the schema/docs (weeks vs.
months here), trust the schema+docs and flag the wording as a slip rather
than silently picking one or adding a new unit-conversion layer. When
reinterpreting a field's meaning requires a data migration, always verify
the migration preserves the real-world effective values (not just "the
numbers are different but plausible") by re-running whatever existing test
already asserts on a concrete hardcoded outcome for that formula.

## 2026-09-11 — Phase 11 (SCRUM-110)
Mistake: adding new tests that call `createRankConfig` to spin up throwaway
"scratch" ranks (needed to test editRankConfig's versioning without
tripping the new "already achieved" guard on a real seeded rank) left
those scratch rows genuinely ACTIVE (`effectiveTo: null`) for the rest of
the same test-file run — cleanup only happened in the file's single
`afterAll`, at the very end. Since `evaluateRankForUser` picks the
highest-`rankOrder` newly-qualified rank, and every scratch rank was
created above OG (the top of the real hierarchy) with a deliberately easy
-to-clear threshold (25,000 MRV / 2 referrals, to prove versioning cheaply),
any LATER test's sponsor who also happened to clear that modest bar got
granted the leftover scratch rank instead of the real rank the test
actually expected (e.g. "Partner") — 5 unrelated `chooseRankReward` tests
started failing with "No rank award found... Partner" only when run AFTER
the new admin-CRUD tests, passing cleanly alone. Confirmed the mechanism
directly (not just retried and hoped) by adding a temporary console.log of
the actual `evaluateRankForUser` result, which showed the sponsor being
granted `ScratchAlreadyAchieved-<uuid>` instead of Partner.
Rule: **a test-created config row in any table `evaluateRankForUser`/
similar "pick the best active row" engine reads from — especially one
positioned to structurally outrank real rows (highest rankOrder, lowest
threshold) — must be deactivated (`effectiveTo` set, not just eventually
deleted) immediately after the test that created it, via a describe
-scoped `afterEach`, not left active until the file's single `afterAll`.**
This is a variant of the standing "any test exercising shared/global state
must neutralize its footprint for its own duration" principle (see the
Phase 4 SCRUM-54 lesson on suspending real investments during an exit
test) — applied here to admin-config rows instead of user/investment
rows. When a set of previously-green tests starts failing only in
combination with newly-added tests earlier in the same file, and passes
cleanly when run alone, suspect exactly this class of cross-test
config-row contamination before assuming flakiness or an unrelated
regression — check what config rows are still active after the new tests
run, not just whether the new tests' own assertions passed.

Second mistake, same ticket: the manual live-verification scratch script's
FIRST run genuinely wrote a real, permanent mutation to the real dev DB's
seeded "Investor" rank_config row (`mrvRequired` 25000 -> 1) — because
that run's `editRankConfig(mainAdmin.id, { rankName: "Investor", ... })`
call, made BEFORE the script also fabricated a rank_awards row for
Investor, correctly found zero real awards for "Investor" in this dev DB
(all earlier test-created Investor awards are always cleaned up by
`afterAll`) and so correctly succeeded — exactly matching the guard's
intended behavior, not a bug. The script's own console.log incorrectly
printed "FAIL: editing Investor should have been refused" for that
outcome, which was actually correct, and the script had no cleanup for
that particular code path since it was written assuming the edit would
throw. This real, uncommitted-anywhere mutation then silently broke two
UNRELATED already-green tests three test runs later
("evaluateRankForUser > a user meeting only the referral count" and
"getRankProgressForUser > an unranked user... nextRank is Investor"),
both of which assert against the REAL seeded Investor thresholds
(25,000/2) rather than a scratch rank, since neither test grants an
Investor award and so never needed the SCRUM-110 achieved-rank guard
-avoidance treatment the other rewritten tests got. Found and fixed:
recomputed the correct restoration directly from the row's own history
(deleted the erroneous new row, reopened the original seed row via
`effectiveTo: null`) rather than guessing the original value, then
re-ran the full suite as proof, per the standing repair principle.
Rule: (1) **manually verifying an admin write function's "refuses X"
behavior against the real dev DB must first confirm the precondition
(here: "at least one real award exists for this rank") is actually
true in THAT database before trusting the refusal check's result** —
"my code's business logic says this should be refused" is not the same
claim as "this specific dev DB's current data makes it refused right
now," and a live-verification script must establish the precondition
itself (as the corrected version of this script eventually did, by
fabricating a real award first) rather than assuming a plausible-sounding
one already holds. (2) When a live-verification script calls any
versioned config admin-write function (`editRankConfig`,
`setInterestRate`, `setCommissionConfig`, etc.) against a REAL seeded
row (not a scratch/throwaway one), it must have unconditional cleanup
(a `finally`, not a cleanup path only reachable from the expected-error
branch) from the very first draft — the same discipline already
standing for ledger-writing scratch scripts (SCRUM-54/79/99 lessons)
applies equally to config-table scratch scripts, and this is the second
time in this same session a manual-verification script needed a repair
pass, which is exactly why the "run the full suite again after manual
verification, before declaring done" step exists — it caught this.

## 2026-09-12 — Phase 11 (post-SCRUM-115, reported by Zac)
Mistake: `src/app/layout.tsx` (the true root layout) was `return children`
with no `<html>`/`<body>` at all — those tags only existed in the nested
`src/app/[locale]/layout.tsx`. This worked for every real page because every
real page lives under `[locale]`. It broke the moment a route matched no
`page.tsx` anywhere (e.g. bare `/admin`, which only has subpages like
`/admin/solvency`, never `/admin` itself): Next.js always resolves its
not-found rendering under the ROOT layout for a genuinely unmatched route,
never under `[locale]/layout.tsx`, even though `[locale]/layout.tsx` is
where the app's real `<html>`/`<body>` shell lives. The root layout's bare
`children` return meant Next's own 404 renderer had no HTML document to
mount into, crashing with "Missing `<html>` and `<body>` tags in the root
layout" instead of showing a 404 page.
Rule: **in any Next.js App Router project using a `[locale]`-style dynamic
segment as the ONLY place `<html>`/`<body>` are rendered, the true root
layout (`src/app/layout.tsx`) must still provide its own minimal
`<html>`/`<body>` fallback shell** — it is reachable independently of
`[locale]/layout.tsx` any time a route matches no page at all, not just for
literal typos in the URL. Fixed: root layout now renders a minimal
`<html lang="en"><body>` wrapper (no nav/next-intl — there is no resolved
locale at this boundary), with `src/app/not-found.tsx` as the only page
rendered inside it (plain bilingual-by-hardcoding text, since it can't use
`useTranslations`). This is a standing requirement for this project, not a
one-off fix: any FUTURE addition of another dynamic top-level segment
(anything else that could 404 with no matching page) should re-check that
the root layout's fallback shell still covers it, rather than assuming
`[locale]/layout.tsx` alone is sufficient.

## 2026-09-12 — Phase 1/10 (discovered via a real login attempt, not code review)
Mistake: `login-form.tsx`'s `totp_enrollment_required` branch (shown when an
admin/sub-admin has no `totpSecret` yet) was a dead-end message + "Back"
button — it never called the fully-built and fully-tested backend
enrollment flow (`/api/auth/totp/enroll`, `/api/auth/totp/confirm`,
`src/lib/totp-enrollment.ts`, with its own passing test file). Since TOTP is
mandatory for every admin with no bypass (`login()` never issues a session
to an admin on password alone), this meant **any admin/sub-admin account
with no TOTP secret could never complete login through the UI at all** —
not a cosmetic gap, a hard lockout. This shipped silently because the
backend was tested in isolation (unit tests call `beginTotpEnrollment`/
`confirmTotpEnrollment` directly) and no exit test or manual verification
pass ever drove a *fresh* admin account through the real browser-facing
login form end to end — every later phase's manual verification reused an
already-enrolled seed admin session (via a pasted/generated cookie) or the
main admin's existing enrollment, never a cold "brand new admin, first
login" path.
Rule: **"the backend function has a passing unit test" is not the same
claim as "a user can actually reach it through the UI"** — any auth/
enrollment flow with more than one branch (login_required vs.
enrollment_required, first-login vs. returning) needs at least one manual
verification pass that starts from the specific branch being checked, not
just the common one. For this project specifically: whenever a new
admin-facing auth path is added or touched, manually drive it starting from
a real account in that path's precondition state (e.g. `totpSecret: null`
for enrollment) through the actual API/UI, not just via a lib-level unit
test — see the fix verification in the SCRUM-115-adjacent todo.md entry for
what that looks like end to end (real secret generated, real TOTP code
computed from it, real confirm call, real resulting session checked against
a real protected route).

## 2026-09-12 — Phase 1 (DISABLE_ADMIN_TOTP dev escape hatch)
Note (not a correction, a standing constraint going forward): added a
`DISABLE_ADMIN_TOTP` config flag (`.env`, read by `auth.ts`'s `login()`) to
unblock manual admin-panel review — a deliberate, user-requested, temporary
weakening of the mandatory-2FA invariant for local dev only. The moment it
was added to `.env`, it silently broke 8 tests in `totp-enrollment.test.ts`
on the very next full-suite run, because `config.ts` loads `.env` via
`dotenv/config` and `vitest` runs on the same host `.env` file as manual dev
work — there is no separate test-environment file.
Rule: **any new env var that changes security/auth-critical behavior must
get an explicit override in `vitest.config.ts`'s `test.env` block, in the
same commit that adds it to `.env`** — never assume "it defaults to safe"
is enough, because a developer's local `.env` (used for exactly this kind
of intentional convenience override) is NOT the same as "the default." The
test suite must always exercise the real enforced/production-equivalent
behavior regardless of what a developer has toggled locally. This is now
the standing pattern for `DISABLE_ADMIN_TOTP` specifically — it stays
forced to `"false"` in `vitest.config.ts` permanently, even after the flag
itself is removed from `.env` before Phase 13 (removing the forced-false
override at that point is harmless, but leaving `.env`'s convenience value
unguarded in the meantime is not).

## 2026-09-13 — Phase 10/11 (admin layout/nav shell missing entirely)
Mistake: Phase 10 shipped the full user dashboard (6 screens) and Phase 11
shipped the full admin panel (12 screens), each screen built and verified
individually against its own exit test — but neither phase ever built a
containing layout with navigation between its own screens until reported
missing after the fact. The admin panel specifically had zero way to
navigate from one screen to another; every admin page was only reachable by
typing its exact URL. This wasn't caught by any phase's exit test because
each exit test verified a screen's OWN functionality/permissions/i18n in
isolation, never "can a user actually get here from another page in the
same area."
Rule: **every phase that builds multiple screens must include an explicit
task for the layout and navigation shell BEFORE any individual screens are
built. The shell comes first — building screens without a containing layout
leaves the admin/user with no way to navigate between them.** This was
missed in both Phase 10 and Phase 11. Going forward: the first ticket in any
multi-screen phase must be "build the layout/nav shell for this area,"
scaffolded with placeholder/empty screens if needed to prove the shell
works, before any real screen's business logic is built — not bolted on
afterward once all the screens already exist.

## 2026-09-18 — post-phase editing session (admin settings page, EMAIL_CHANGED enum)
Mistake: adding a single new `SecurityEventType` enum value via `npx prisma
migrate dev --name add_email_changed_security_event` generated a migration
that included an unrelated, unintended second change: it dropped and
recreated `binary_nodes_parent_id_fkey` with `ON DELETE SET NULL` instead of
its original, deliberate `ON DELETE RESTRICT` (set in
`20260821130000_add_binary_nodes`). Root cause: `schema.prisma`'s `parent
BinaryNode? @relation("BinaryTree", fields: [parentId], references:
[userId])` never declared `onDelete` explicitly — Prisma's implicit default
for an optional scalar relation is `SetNull`, which differed from what the
live DB actually had (`RESTRICT`, applied by hand in the original migration
but never mirrored back into an explicit schema annotation). `migrate dev`
diffs the live DB against the schema and silently "fixes" any such
drift — in this case in the wrong direction, weakening invariant #7 (no
hard delete on users) by letting a deleted node orphan its children instead
of blocking the delete. Caught only because the generated migration.sql was
read line-by-line before trusting the CLI's "up to date" success message,
not because of any test failure or warning.
Rule: **after running any `prisma migrate dev`, always read the generated
`migration.sql` in full before considering the migration done — a migration
intended to add ONE thing can silently include unrelated DDL for any
existing field lacking an explicit relation attribute the schema currently
defaults differently from the live DB.** Any FK with non-default delete
behavior (anything other than Prisma's implicit default) must have its
`onDelete` written explicitly in `schema.prisma`, never left to infer
correctly by coincidence — this makes future diffs deterministic instead of
dependent on what the live DB happens to already have. Fixed here by (1)
adding `onDelete: Restrict` explicitly with a comment explaining why, and
(2) a second corrective migration
(`20260918194405_restore_binary_nodes_parent_restrict`) restoring `RESTRICT`
on the live DB before continuing with the actually-intended `EMAIL_CHANGED`
work.

## 2026-09-18 — post-phase editing session (admin settings page)
Mistake: none in new code this time, but a real latent bug in
`src/components/logo.tsx` (shared by every page, untouched by this
session's actual edits) was exposed and fixed. `LogoMarkSvg`'s `<defs>`
used hardcoded gradient `id`s (`investaLegGradient`, etc.). This was
harmless as long as at most one `<LogoMark>`/`<LogoFull>` instance ever
rendered per page — true everywhere until a prior session's admin-layout
mobile-nav work (`src/app/[locale]/admin/layout.tsx`) added a second,
simultaneously-DOM-present logo instance (desktop `<aside>` sidebar +
`lg:hidden` mobile top-bar), both defining `id="investaLegGradient"` etc.
SVG `fill="url(#id)"` resolves against the *whole document*, not scoped to
the local `<svg>` — with two elements sharing an id, one instance's
`<linearGradient>` definitions won and the other rendered with a broken/
empty fill, i.e. the mark appeared completely invisible on that page.
Confirmed via `document.querySelectorAll('[id="investaLegGradient"]').length
=== 2` on the live admin page, not by guessing — a DOM inspection that
directly confirmed correct `viewBox`/size/path-count on the "invisible"
`<svg>` element had already ruled out every other plausible cause (stale
compile, wrong classes, CSS visibility) before this was found.
Rule: **any SVG component that might ever render more than once
simultaneously on the same page must scope its internal `<defs>` ids per
instance** (`React.useId()`, prefixed onto each id) — a hardcoded literal
id inside reusable SVG markup is a latent bug from the moment the component
is written, not just from the moment a second instance actually appears;
it's invisible in isolation and in every render that only ever mounts one
copy, so normal review/testing won't catch it until something later
(intentionally or not) puts two on the page at once. When a component
renders correct markup/attributes by every DOM-level check yet is visually
absent, check for id collisions across the whole document before assuming
a compile/cache/CSS cause — `fill="url(#foo)"`/`clip-path="url(#foo)"`/etc.
are exactly this failure's fingerprint. Fixed by making `logo.tsx`
(previously a plain Server Component) a Client Component so `useId()` is
available, confirmed safe since none of its 4 call sites pass server-only
data through it.
