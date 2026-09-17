FROM node:26-slim AS base
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# --- Development ---
# Kept as an intermediate named stage, BEFORE `prod` in file order, so local
# dev (docker-compose.yml's `target: dev`) still works unchanged — Docker
# resolves a named target by name, not by file position.
FROM base AS dev
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY . .
RUN npx prisma generate
CMD ["npm", "run", "worker"]

# --- Production ---
# Keeps running via tsx (per SCRUM-124 decision — consistent with dev, and
# the worker has no build step of its own to compile ahead of time), but
# with only production dependencies plus tsx itself (needed at runtime here,
# unlike the app image which ships a fully-built Next server) and no
# bind-mounted source — the image is self-contained.
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm install tsx@^4.23.11 --no-save

# `prod` is deliberately the LAST stage in this file — same reasoning as
# docker/app.Dockerfile (SCRUM-129): a platform whose UI has no way to pass
# `docker build --target` (confirmed on Render) always builds whichever
# stage comes last with a plain `docker build`.
FROM base AS prod
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/prisma ./prisma
COPY src/worker ./src/worker
COPY src/lib ./src/lib
COPY prisma ./prisma
RUN npx prisma generate
CMD ["npx", "tsx", "src/worker/index.ts"]
