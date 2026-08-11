# Current Session Todo

> Claude Code: overwrite this file at the start of each session with the checklist
> for the phase you're working on. Check items off as you complete them. Leave the
> "Review" section filled in at the end so the human reviewer (Zac) can see what
> happened without re-reading the whole transcript.

## Phase: 0 — Foundation

- [x] Scaffold Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- [x] Set up next-intl: route-based `/en` and `/ar`, empty `messages/en.json` /
      `messages/ar.json`, `dir="rtl"` wired to Arabic on root element, language
      switcher stub in layout
- [x] Docker Compose: `app`, `worker`, `postgres` (Postgres 16) services
- [x] Initialize Prisma, verify connection to Postgres (empty schema is fine —
      real models start Phase 1/2)
- [x] Configure ESLint + Prettier + Vitest
- [x] Add ESLint rule / documented checklist item flagging JS `number` for money
      (invariant #1 enforcement starts now)
- [x] `.env.example` committed, `.env` gitignored; typed config module exposing
      `TIMEZONE` (`Asia/Dubai`, named zone not offset), `MIN_WITHDRAWAL` (50),
      and rate placeholders
- [x] Health check route: app status + DB reachability
- [x] Worker service present in compose (no jobs yet — lands Phase 4)
- [x] Run exit test: `docker compose up` → app running, DB reachable, health
      check confirms both, `/en` and `/ar` render, `/ar` has `dir="rtl"`
- [x] Show exit test output to Zac before marking phase complete

## Review

**Built:**
- Next.js 15.5.23 (App Router, TS, Tailwind v4) scaffolded at repo root, merged
  around existing `docs/`, `tasks/`, `CLAUDE.md`.
- shadcn/ui initialized (`components.json`, `src/components/ui/button.tsx`,
  `src/lib/utils.ts`).
- next-intl: `src/app/[locale]/`, `src/i18n/{routing,navigation,request}.ts`,
  `src/middleware.ts`, `messages/{en,ar}.json` (with a glossary comment noting
  financial terms never translate), `dir` wired per-locale in
  `[locale]/layout.tsx`, language switcher stub in the header.
- `docker-compose.yml`: `app`, `worker`, `postgres:16` with a healthcheck-gated
  dependency so app/worker wait for Postgres readiness. `docker/app.Dockerfile`,
  `docker/worker.Dockerfile`.
- Prisma initialized and **pinned to v6.19.3** (see decision below), empty
  schema, `src/lib/prisma.ts` singleton, client generated successfully both
  locally and inside the Docker image.
- ESLint (flat config via `FlatCompat`, since this Next version's
  `eslint-config-next` only ships legacy eslintrc-format configs), Prettier,
  Vitest all configured and passing. Added a `no-restricted-syntax` ESLint rule
  flagging `parseFloat()` and non-literal `Number()` calls as advisory nudges
  toward invariant #1 (can't fully enforce "no JS number for money" via static
  rule alone — documented as such in the rule's own message).
- `src/lib/config.ts`: Zod-validated typed config exposing `TIMEZONE` (locked to
  literal `"Asia/Dubai"`), `MIN_WITHDRAWAL` (default 50), and two rate
  placeholders, explicitly commented that real rates come from versioned config
  tables from Phase 2+ (invariant #6).
- Health check at `/api/health`, outside the locale prefix, using tagged-template
  `$queryRaw` (invariant #10).
- `.env.example` committed, `.env` gitignored with an explicit `!.env.example`
  negation (the Prisma-generated `.gitignore` used a blanket `.env*` that would
  have excluded the example file too).

**Decision requiring a stop-and-ask:** `npx prisma init` pulled Prisma 7 (latest),
which requires an explicit driver adapter, a new `prisma.config.ts`, and a
generated-client output path — a bigger convention change than this
Prisma-heavy, 13-phase project should absorb without discussion. Asked; you chose
Prisma 6. Pinned `prisma`/`@prisma/client` to `6.19.3`, reverted to the
conventional `schema.prisma` + `@prisma/client` import + `DATABASE_URL` env var
setup.

**Mistake caught and fixed (logged in `tasks/lessons.md`):** while cleaning up
stray files `prisma init` wrote into `.claude/skills/`, briefly deleted two
already-committed skill files (`bilingual-rtl`, `money-precision`) that weren't
scaffolding byproducts. Caught via `git status` before finishing and restored
with `git checkout --`.

**Exit test — actually run, output below:**

```
$ docker compose up --build -d
...
 Container investment_hub-postgres-1 Healthy
 Container investment_hub-app-1 Started
 Container investment_hub-worker-1 Started

$ docker compose ps
NAME                        STATUS
investment_hub-app-1        Up (0.0.0.0:3000->3000/tcp)
investment_hub-postgres-1   Up (healthy) (0.0.0.0:5432->5432/tcp)
investment_hub-worker-1     Up

$ curl -s http://localhost:3000/api/health
{"status":"ok","database":"reachable"}

$ curl -s -D - http://localhost:3000/en -o /tmp/en.html
HTTP/1.1 200 OK
<html lang="en" dir="ltr" ...>
<h1>Investment Hub</h1>

$ curl -s -D - http://localhost:3000/ar -o /tmp/ar.html
HTTP/1.1 200 OK
<html lang="ar" dir="rtl" ...>
<h1>Investment Hub</h1>

$ curl -s -D - -o /dev/null http://localhost:3000/
HTTP/1.1 307 Temporary Redirect
location: /en
```

Local checks also run and passing before the Docker test: `npx tsc --noEmit`
(clean), `npx eslint .` (clean), `npx vitest run` (1/1 passing), `npx prettier
--check .` (clean on all app source).

**What to double-check by hand:** the stack is currently still running
(`docker compose up -d`) — stop it with `docker compose down` when done
reviewing, or ask me to. The 3 `npm audit` high-severity warnings are all in
`postcss`/`sharp`, transitively bundled inside Next 15.5.23's build tooling;
fixing them requires jumping to Next 16, which conflicts with this phase's
pinned Next 15 requirement — left as-is, flagging for awareness rather than
silently overriding the version pin.
