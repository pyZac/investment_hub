-- CreateEnum
CREATE TYPE "RankRewardType" AS ENUM ('CASH', 'CASH_OR_TRIP');

-- CreateTable
CREATE TABLE "rank_config" (
    "id" TEXT NOT NULL,
    "rank_name" TEXT NOT NULL,
    "mrv_required" DECIMAL(24,8) NOT NULL,
    "direct_referrals_required" INTEGER NOT NULL,
    "reward_amount" DECIMAL(24,8) NOT NULL,
    "reward_type" "RankRewardType" NOT NULL,
    "rank_order" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rank_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- "At most one active row per rank_name" — unlike commission_config's single
-- global-active-row constant-expression index, multiple ranks are active
-- simultaneously here, so the index is on the real (never-null) rank_name
-- column itself, scoped by the same effective_to IS NULL partial condition.
-- This is NOT the NULL-column trap from the interest_rate_config/
-- commission_config lesson — that bug was about indexing a column that is
-- NULL on every qualifying row, so no two rows could ever collide. rank_name
-- is always a real string, so two active rows for the same rank genuinely
-- collide on this index.
CREATE UNIQUE INDEX "rank_config_one_active_per_rank"
  ON "rank_config" ("rank_name")
  WHERE "effective_to" IS NULL;

-- Seed: the 8 ranks from mlm_rules_log.md Section 6, exact seed configuration.
INSERT INTO "rank_config"
  ("id", "rank_name", "mrv_required", "direct_referrals_required", "reward_amount", "reward_type", "rank_order", "effective_from", "effective_to")
VALUES
  ('seed-rank-investor',  'Investor',  25000.00000000,       2, 500.00000000,       'CASH',          1, CURRENT_TIMESTAMP, NULL),
  ('seed-rank-partner',   'Partner',   100000.00000000,      4, 2000.00000000,      'CASH_OR_TRIP',  2, CURRENT_TIMESTAMP, NULL),
  ('seed-rank-executive', 'Executive', 500000.00000000,      6, 10000.00000000,     'CASH',          3, CURRENT_TIMESTAMP, NULL),
  ('seed-rank-director',  'Director',  2000000.00000000,     8, 40000.00000000,     'CASH',          4, CURRENT_TIMESTAMP, NULL),
  ('seed-rank-president', 'President', 7500000.00000000,    10, 150000.00000000,    'CASH',          5, CURRENT_TIMESTAMP, NULL),
  ('seed-rank-chairman',  'Chairman',  20000000.00000000,   12, 400000.00000000,    'CASH',          6, CURRENT_TIMESTAMP, NULL),
  ('seed-rank-visionary', 'Visionary', 50000000.00000000,   15, 1000000.00000000,   'CASH',          7, CURRENT_TIMESTAMP, NULL),
  ('seed-rank-og',        'OG',        100000000.00000000,  20, 2000000.00000000,   'CASH',          8, CURRENT_TIMESTAMP, NULL);
