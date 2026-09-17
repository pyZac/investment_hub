FROM node:26-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# Dedicated stage for the migrate/seed toolchain's node_modules — a clean
# copy of `deps`'s install (already includes prisma, the CLI needed for
# `prisma migrate deploy`) plus tsx (needed to run prisma/seed.ts directly,
# since it's TypeScript and tsx is a devDependency not otherwise reachable
# from the isolated /app/migrate directory the prod stage uses). Installing
# tsx HERE, into a normal npm-managed directory (real package.json present,
# from the `deps` COPY above), then copying the RESULT wholesale into
# `prod` below — never running `npm install` a second time directly inside
# an already-copied, package.json-less node_modules tree, which risks npm
# reconciling/rewriting that tree in ways that can silently break existing
# bin symlinks (confirmed as the likely cause of a real "prisma: not found"
# failure when tsx was previously installed this way, post-copy, in `prod`).
FROM deps AS migrate-deps
RUN npm install tsx@^4.23.11 --no-save

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
# The Prisma CLI (needed to run `prisma migrate deploy` and the seed script
# before the server starts serving traffic) is NOT part of Next's standalone
# trace — standalone only traces what the running Next.js SERVER needs at
# request time, and this project never imports the `prisma` CLI package
# from application code, only from an out-of-band CLI invocation.
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
COPY --from=migrate-deps /app/node_modules ./migrate/node_modules
# seed.ts imports from src/lib (prisma client, config, password hashing,
# wallet creation) — copied here so the seed step can run standalone
# without needing the rest of the app's source tree.
COPY --from=builder /app/src/lib ./migrate/src/lib
COPY --from=builder /app/prisma ./migrate/prisma
COPY scripts/start.sh ./scripts/start.sh
RUN chmod +x ./scripts/start.sh
EXPOSE 3000
CMD ["/bin/sh", "/app/scripts/start.sh"]
