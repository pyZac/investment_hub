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
EXPOSE 3000
CMD ["node", "server.js"]
