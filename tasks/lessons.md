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
