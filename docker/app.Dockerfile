FROM node:22-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# --- Development ---
# Kept as an intermediate named stage, BEFORE `prod` in file order, so local
# dev (docker-compose.yml's `target: dev`) still works unchanged — Docker
# resolves a named target by name, not by file position, so this stage's
# position doesn't affect docker-compose.yml at all. Only a target-less
# `docker build` (Render's situation, see below) cares about stage order.
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .
RUN npx prisma generate
EXPOSE 3000
CMD ["npm", "run", "dev"]

# --- Production ---
# Next's `output: "standalone"` (next.config.ts) traces the minimal runtime
# node_modules subset into .next/standalone, so the runtime stage below never
# needs `npm ci` at all — only the build stage installs full (dev+prod) deps
# to run `next build`.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .
RUN npx prisma generate
ENV NODE_ENV=production
RUN npm run build

# `prod` is deliberately the LAST stage in this file: Render's UI has no way
# to pass `docker build --target`, so it always builds whichever stage comes
# last with a plain `docker build` (confirmed directly — Render's build log
# showed `[dev 3/4]`/`[dev 4/4]` running instead of `prod` while `dev` was
# still the final stage, serving the unbuilt dev image in production and
# crashing the Edge Runtime middleware). Verified locally after this fix:
# a target-less `docker build -f docker/app.Dockerfile .` now produces an
# image containing `server.js` (only present in this stage) and
# `CMD ["node", "server.js"]`, not the dev image.
FROM base AS prod
ENV NODE_ENV=production
# Standalone server needs .next/static and public/ copied alongside it —
# `next start` is NOT used here (that requires the full node_modules this
# image deliberately doesn't have); the traced server.js is the entrypoint.
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
# The Prisma CLI (needed for Render's pre-deploy `prisma migrate deploy`
# command, per docs/runbook.md's "Running migrations" section) is NOT part
# of Next's standalone trace — standalone only traces what the running
# Next.js SERVER needs at request time, and this project never imports the
# `prisma` CLI package from application code, only from an out-of-band CLI
# invocation.
#
# Cherry-picking individual node_modules subfolders (prisma, @prisma/engines,
# etc.) was tried and does NOT work: the CLI's dependency graph goes deeper
# than it looks from the top-level @prisma/* packages — confirmed directly,
# `@prisma/config` alone pulls in further packages (e.g. `effect`) not
# under the `prisma`/`@prisma` scope at all, and there is no reliable way to
# enumerate a package's full transitive closure by hand. Copying the
# ENTIRE node_modules from the `deps` stage (a real `npm ci`, which resolves
# the complete graph correctly by construction) is the only approach that
# doesn't silently break on the next dependency bump.
#
# Kept under a separate `migrate/` path, not merged into the app's own
# node_modules — `deps`'s node_modules predates `prisma generate`, so it has
# an UNGENERATED @prisma/client; merging it in would silently overwrite
# .next/standalone's real, working generated client (confirmed this
# collision directly while diagnosing the cherry-pick approach above).
# Isolating it under `migrate/` means the CLI is invoked from that
# directory (`cd migrate && node_modules/.bin/prisma migrate deploy`, from
# the repo root's own prisma/schema.prisma) without ever touching the
# server's own module resolution.
COPY --from=deps /app/node_modules ./migrate/node_modules
EXPOSE 3000
CMD ["node", "server.js"]
