# Backup service (Phase 13 / SCRUM-127) — runs scripts/backup.sh as a
# Railway Cron Service. No Node/npm needed at all: this is a plain
# pg_dump/bash job, kept minimal and independent of the app/worker images.
#
# postgresql-client-16 matches the project's real Postgres server version
# (16.14, confirmed via `postgres --version` against the dev container) —
# pg_dump/pg_restore should always match (or be newer than) the server
# they talk to. Debian 12 (bookworm)'s own apt repos only ship
# postgresql-client-15 — confirmed directly (`apt-get install
# postgresql-client-16` fails with "Unable to locate package" on plain
# debian:12-slim) — so the official PGDG apt repository has to be added
# explicitly to get version 16.
FROM debian:12-slim

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       curl \
       gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
       --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update -y \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y curl gnupg \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY scripts/backup.sh ./backup.sh
RUN chmod +x ./backup.sh

# BACKUP_DIR defaults to /backups (see scripts/backup.sh) — mount a Railway
# volume there so backups survive service restarts. See docs/runbook.md's
# "Backup service" section for the exact dashboard mount configuration.
CMD ["./backup.sh"]
