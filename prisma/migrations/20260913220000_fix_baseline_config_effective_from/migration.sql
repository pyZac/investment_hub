-- SCRUM-121 (discovered while validating a from-scratch CI run): the 3
-- baseline config migrations (20260816120000_add_interest_rate_config,
-- 20260821120000_add_commission_config, 20260822130000_add_rank_config)
-- each INSERT their seed row using effective_from = CURRENT_TIMESTAMP —
-- i.e. "active starting whenever this migration happens to run," not a
-- fixed historical date. This never surfaced before because every prior
-- session ran migrations once, long ago, against the same long-lived dev
-- DB, and every test's fabricated date happened to fall after that
-- original migration-run timestamp. Running migrate deploy against a truly
-- fresh database TODAY reproduces it immediately: any test using an
-- earlier fabricated date (e.g. 2026-08-20) finds no row whose
-- effective_from is <= that date, since "today" (whenever this environment
-- was deployed) is later than the test's fabricated date.
--
-- Fixed by UPDATE, not by editing the original 3 migrations' already
-- -applied SQL (this project's own standing rule: a hand-edited migration
-- after `migrate dev` has already applied it triggers a checksum-drift
-- reset the next time `migrate dev` runs — see tasks/lessons.md). A new
-- migration correcting historical data is the safe pattern.
UPDATE "interest_rate_config"
  SET "effective_from" = '2020-01-01 00:00:00'
  WHERE "id" = 'seed-interest-rate-5pct';

UPDATE "commission_config"
  SET "effective_from" = '2020-01-01 00:00:00'
  WHERE "id" = 'seed-commission-config-v1';

UPDATE "rank_config"
  SET "effective_from" = '2020-01-01 00:00:00'
  WHERE "id" IN (
    'seed-rank-investor', 'seed-rank-partner', 'seed-rank-executive',
    'seed-rank-director', 'seed-rank-president', 'seed-rank-chairman',
    'seed-rank-visionary', 'seed-rank-og'
  );
