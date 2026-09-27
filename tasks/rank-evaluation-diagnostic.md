# Rank Evaluation diagnostic — read-only, safe to run on production

Confirms whether the reported "Investor rank not granted" case is expected
month-timing behavior (most likely) or a genuine second bug. Writes nothing —
every query below is a plain `SELECT`.

## 1. Find the user

Replace `<email or name>` with whatever identifies them.

```sql
SELECT id, name, email, sponsor_id, suspended_at
FROM users
WHERE email = '<email or name>' OR name ILIKE '%<email or name>%';
```

Copy their `id` for the next queries (`<user_id>`).

## 2. Which month(s) is their MRV actually recorded under?

```sql
SELECT month, volume
FROM mrv_periods
WHERE user_id = '<user_id>'
ORDER BY month DESC;
```

**What to look for**: is the `$27,000` (or `27000.00000000`) row under
`2026-09` (September, the current in-progress month) or `2026-08` (August,
already-completed)?

- If it's under **2026-09** → this confirms the root cause exactly:
  `runRankEvaluationCatchUp` only ever evaluates the most recently
  *completed* month (August, when run in September) — by design, not a
  bug (see `mlm_rules_log.md` Section 6: "must be achieved within the same
  calendar month," and a month isn't closeable until it fully ends). The
  rank will be evaluated and granted automatically at 00:10 Asia/Dubai on
  **October 1st**, once September is the most recently closeable month.
  No action needed.
- If it's under **2026-08** with `volume >= 25000`, and the user still
  wasn't granted Investor → that would be a genuine, different bug worth
  investigating further (the August evaluation should have caught it).

## 3. Confirm what the manual job trigger actually evaluated

```sql
SELECT period_key, status, started_at, completed_at, error
FROM job_runs
WHERE job_type = 'rank_evaluation'
ORDER BY period_key DESC;
```

**What to look for**: the most recent `COMPLETED` row's `period_key`. It
should read `2026-08` (or whatever month was most recently closeable at
the moment it was triggered) — never `2026-09` while September is still
in progress. If it says `2026-08` and step 2 shows the $27,000 landed in
`2026-09`, that's the full confirmation: the job correctly evaluated a
month that had no qualifying MRV for this user.

## 4. Double-check the qualified-referral count independently

```sql
SELECT id, name, suspended_at,
  EXISTS (
    SELECT 1 FROM investments i
    WHERE i.user_id = u.id AND i.status = 'ACTIVE'
  ) AS has_active_investment
FROM users u
WHERE sponsor_id = '<user_id>';
```

Count how many rows have `suspended_at IS NULL AND has_active_investment =
true` — that count must be >= 2 for the referral requirement. This is a
live, uncached count (mirrors `qualifiedDirectReferralCount` in
`src/lib/rank.ts` exactly), so it should already match what you observed
in the admin panel.

## If step 2 confirms September

No code change is needed — this is expected behavior working correctly.
If you want the rank granted sooner than October 1st without changing the
evaluation timing rule itself, the existing Developer Tools page
(`/admin/developer-tools`) can manually trigger `rank_evaluation` again
**on or after October 1st**, which will then evaluate September and grant
the rank the same way the scheduled run would.
