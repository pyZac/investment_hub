# Phase 0 — Foundation

**Goal:** an empty app that boots, connects to Postgres, and deploys.

**Prerequisites:** none. This is the first phase.

**Read before starting:** `/docs/build_plan.md` Part 1 (Tech Stack) and the
bilingual requirement subsection. Nothing else is needed this phase.

## Deliverables

1. Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui scaffold.
2. **next-intl scaffolding** — route-based locales (`/en`, `/ar`), empty
   `messages/en.json` and `messages/ar.json` catalogs, `dir="rtl"` wired to the
   Arabic locale on the root element, language switcher stub in the layout.
   Set this up now: every component built in later phases uses translation keys
   from day one. Retrofitting translations later is far more expensive.
3. Docker Compose with three services: `app`, `worker`, `postgres` (Postgres 16).
4. Prisma initialised, connection to Postgres verified.
5. ESLint + Prettier + Vitest configured.
6. `.env` handling (`.env.example` committed, `.env` gitignored) and a typed
   config module exposing at minimum `TIMEZONE` (= `Asia/Dubai`), `MIN_WITHDRAWAL`
   (= 50), and placeholders for rates.
7. Health check route returning app status + DB reachability.

## Constraints specific to this phase

- Postgres, not SQLite — SQLite has no true decimal type and drift will break the
  audit ledger. This is non-negotiable (see `/docs/build_plan.md`, "Why PostgreSQL").
- Timezone is stored as the named zone `Asia/Dubai`, never a raw `+04:00` offset.
- Add an ESLint rule (or at minimum a documented code-review checklist item) that
  flags JS `number` used for money — invariant #1 starts being enforceable now.
- The worker service exists in compose from day one even though it has no jobs
  yet; it's where `node-cron` lands in Phase 4.

## Exit test

`docker compose up` gives a running app plus a reachable database. The health
check route confirms both. `/en` and `/ar` both render, and `/ar` renders with
`dir="rtl"`.

Run it and show the output. Do not mark this phase complete on inspection alone.
