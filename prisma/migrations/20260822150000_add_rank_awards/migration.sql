-- CreateEnum
CREATE TYPE "RankRewardChoice" AS ENUM ('CASH', 'TRIP');

-- CreateTable
-- Rank grant record — permanent, once-ever per (user, rank), enforced by
-- UNIQUE(user_id, rank). reward_amount/reward_type are snapshotted from the
-- active rank_config row at grant time (invariant #6 — a later config edit
-- never retroactively changes an already-granted award). reward_choice is
-- only ever set for CASH_OR_TRIP ranks (Partner), by the user's own later
-- choice (a separate ticket). credited_at is null until the weekly Friday
-- payout sweep (a separate ticket) actually credits Wallet C; a TRIP choice
-- never gets credited_at via a ledger credit — logged-only award.
CREATE TABLE "rank_awards" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "achieved_month" TEXT NOT NULL,
    "reward_amount" DECIMAL(24,8) NOT NULL,
    "reward_type" "RankRewardType" NOT NULL,
    "reward_choice" "RankRewardChoice",
    "credited_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rank_awards_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "rank_awards" ADD CONSTRAINT "rank_awards_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "rank_awards_user_id_rank_key"
  ON "rank_awards" ("user_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "rank_awards_idempotency_key_key"
  ON "rank_awards" ("idempotency_key");
