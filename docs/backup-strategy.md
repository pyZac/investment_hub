# Postgres Backup Strategy

This is the backup **runbook** for the Investment Webapp Simulation: how to take a
backup, what to keep and for how long, and how to restore one. It defines the
approach; it does not stand up automation.

**Out of scope here, owned by Phase 13 (Deployment):** scheduling backups on a
cron, and copying backup files off the host they were taken on. Everything below
assumes a human (or a future Phase 13 script) runs these commands manually.

---

## 1. Taking a backup (`pg_dump`)

The database runs in the `postgres` service of `docker-compose.yml`, container name
`investment_hub-postgres-1`, database name `investment_hub`, user `postgres`.

### Exact command

Run from the host, with the stack up (`docker compose up -d`):

```bash
docker compose exec -T postgres pg_dump -U postgres -d investment_hub -F c -f /tmp/backup.dump
docker compose cp postgres:/tmp/backup.dump "./backups/investment_hub_$(date -u +%Y%m%dT%H%M%SZ).dump"
docker compose exec -T postgres rm /tmp/backup.dump
```

**On Windows Git Bash specifically** (this project's documented host shell —
see CLAUDE.md's environment section), prefix every command in this document
that contains a `/tmp/...` path with `MSYS_NO_PATHCONV=1`. Git Bash's MSYS layer
rewrites a leading `/tmp/...` into a Windows path (`C:/Users/.../Temp/...`)
before Docker ever sees it, which breaks every command below verbatim —
confirmed directly: `pg_dump ... -f /tmp/backup.dump` fails with `could not open
output file "C:/Users/.../Temp/backup.dump": No such file or directory` without
the prefix, and succeeds with it. macOS/Linux shells don't have this rewriting
behavior and don't need the prefix. Example:

```bash
MSYS_NO_PATHCONV=1 docker compose exec -T postgres pg_dump -U postgres -d investment_hub -F c -f /tmp/backup.dump
```

Notes on the flags:

- `-F c` — custom format (compressed, and the only format `pg_restore` can
  selectively restore from). Never use plain-text `-F p` for a real backup; it's
  larger and can't be restored selectively.
- `-T` on `docker compose exec` — disables pseudo-TTY allocation, needed because
  the dump is piped/copied rather than viewed interactively.
- The dump is written inside the container first, then copied out and removed —
  `pg_dump` writing directly to a host-mounted path also works if a volume is
  already mounted for it, but the copy-then-delete approach needs no extra volume
  configuration in `docker-compose.yml`.
- Filename uses UTC and no colons (`YYYYMMDDTHHMMSSZ`), so it sorts
  chronologically as a plain string and is safe on every filesystem this project
  might run backups from.

### Where backups land

Local `./backups/` (create it if it doesn't exist; `/backups` is already added
to `.gitignore` as part of this doc — backup files must never be committed,
they contain real user data). This directory is the local staging area only;
Phase 13's off-box copy step is what makes a backup actually durable against
host loss.

### Verifying a backup immediately after taking it

A backup file that can't be read isn't a backup. After every dump (on Windows
Git Bash, prefix each line below with `MSYS_NO_PATHCONV=1` as shown above):

```bash
docker compose cp "./backups/investment_hub_<timestamp>.dump" postgres:/tmp/verify.dump
docker compose exec -T postgres pg_restore -l /tmp/verify.dump
docker compose exec -T postgres rm /tmp/verify.dump
```

`pg_restore -l` lists the dump's table of contents without restoring anything —
if it prints the expected list of tables (`users`, `wallets`, `ledger_entries`,
`admin_actions`, `security_events`, etc.), the dump file is structurally sound.
An empty or error output means the backup is unusable and must be retaken before
trusting it — do not discover a bad backup only when an actual restore is needed.

---

## 2. Retention policy

This is a small internal simulation, not a high-write-volume production system —
the retention policy favors simplicity over exhaustive coverage:

| Backup age       | Kept?                          |
|------------------|---------------------------------|
| Last 7 days      | Every daily backup kept         |
| 8–30 days old     | One backup per week kept        |
| 31–90 days old    | One backup per month kept       |
| Older than 90 days | Deleted                        |

Rationale: the first week covers "something broke yesterday, restore to
yesterday morning" — the most likely real recovery scenario. The weekly/monthly
tiers cover "we need to see what the data looked like a while ago" (an audit
question, a disputed ledger entry, a suspected slow-burn bug) without keeping
every single daily file forever. 90 days total is generous for a simulation with
no regulatory retention requirement — extend it if a real compliance need ever
applies, but don't keep backups indefinitely by default; unbounded retention on
an internal box is itself a liability (more surface area for the backup files
themselves to leak, more disk to manage).

Applying this policy is a manual step until Phase 13 automates it — when
pruning, always keep the *oldest* backup in a tier being collapsed (e.g. when
collapsing week-8's 7 daily backups into "one per week," keep the first day of
that week, not the last), so the retained backup's age is predictable.

---

## 3. Restore runbook

**Read this whole section before running anything.** A restore overwrites real
data — confirm which environment you are restoring into before starting, and
never restore into a database anyone might currently be actively using with real
data you'd overwrite.

### Step 1 — Stop the app and worker (not Postgres itself)

```bash
docker compose stop app worker
```

Stopping `app`/`worker` (not `postgres`) prevents new writes from landing mid-restore
and racing with the restore process, while leaving Postgres itself up so
`pg_restore` can connect to it.

### Step 2 — Copy the backup file into the postgres container

(Windows Git Bash: prefix with `MSYS_NO_PATHCONV=1`, per the note in section 1.)

```bash
docker compose cp "./backups/investment_hub_<timestamp>.dump" postgres:/tmp/restore.dump
```

### Step 3 — Drop and recreate the target database

This is the point of no return for whatever is currently in `investment_hub` —
confirm you intend to discard it before running this.

```bash
docker compose exec -T postgres psql -U postgres -c "DROP DATABASE IF EXISTS investment_hub;"
docker compose exec -T postgres psql -U postgres -c "CREATE DATABASE investment_hub;"
```

### Step 4 — Restore

(Windows Git Bash: prefix with `MSYS_NO_PATHCONV=1`.)

```bash
docker compose exec -T postgres pg_restore -U postgres -d investment_hub /tmp/restore.dump
```

`pg_restore` against a custom-format (`-F c`) dump recreates the schema and data
from scratch — no prior `prisma migrate deploy` step is needed or wanted here,
since the dump already contains the full schema as it existed at backup time
(restoring to an intentionally older schema version, then separately running
any migrations added since, is a deliberate choice for a specific recovery
scenario, not the default path).

### Step 5 — Clean up and verify

(The `rm` line needs `MSYS_NO_PATHCONV=1` on Windows Git Bash; the `psql -c`
line does not, since it has no `/tmp/...` argument.)

```bash
docker compose exec -T postgres rm /tmp/restore.dump
docker compose exec -T postgres psql -U postgres -d investment_hub -c "SELECT count(*) FROM users;"
```

A non-error row count confirms the restore landed. For a more thorough check
before declaring the restore complete, run this project's own reconciliation
check (`src/lib/reconciliation.ts`'s `runReconciliation()`, invoked via the
job-monitor admin screen or a one-off script) against the restored database —
a clean reconciliation report is stronger evidence of a correct restore than a
row count alone, since it confirms the ledger and cached balances agree, not
just that data exists.

### Step 6 — Restart the app and worker

```bash
docker compose start app worker
```

---

## 4. What this document does not cover

- **Scheduling backups automatically** (a cron job, a systemd timer, a
  scheduled GitHub Action) — Phase 13's job.
- **Copying backup files off the host they were taken on** (to object storage,
  a separate backup server, etc.) — also Phase 13's job. Until that exists,
  a backup living only in `./backups/` on the same host as the live database
  protects against *data corruption* (a bad migration, a bug, accidental
  deletion) but not against *host loss* (disk failure, the whole machine
  disappearing) — know which failure mode a given backup actually protects
  against before relying on it.
- **Point-in-time recovery** (continuous WAL archiving) — this project's backup
  strategy is periodic full dumps only; restoring recovers to the moment the
  last dump was taken, not to an arbitrary point in between. If that gap ever
  becomes unacceptable, WAL archiving is the next tool to reach for, but it's
  a meaningfully larger operational commitment than this document's scope.
