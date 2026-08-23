-- CreateTable
-- Records a rank whose threshold was met in a given month but was NOT
-- awarded because a HIGHER rank won that same month (only the highest
-- newly-achieved rank is paid). Distinct from rank_awards (strictly real,
-- rewarded grants) so rank_awards stays a clean audit trail of actual
-- payouts. Exists purely to make forfeiture PERMANENT: once a lower rank is
-- forfeited to a higher one in some month, re-meeting that same lower
-- rank's threshold again in a LATER month must not grant it either.
CREATE TABLE "rank_forfeits" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rank" TEXT NOT NULL,
    "forfeit_month" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rank_forfeits_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "rank_forfeits" ADD CONSTRAINT "rank_forfeits_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "rank_forfeits_user_id_rank_key"
  ON "rank_forfeits" ("user_id", "rank");
