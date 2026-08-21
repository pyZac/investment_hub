-- CreateTable
-- One row per (ancestor, purchase). Only real package purchases generate BV
-- (docs/mlm_rules_log.md Section 5) — never profits, commissions, rank
-- rewards, or transfers. UNIQUE(ancestor_user_id, source_investment_id) is
-- both the "one entry per ancestor per purchase" invariant and the replay
-- guard.
CREATE TABLE "bv_entries" (
    "id" TEXT NOT NULL,
    "ancestor_user_id" TEXT NOT NULL,
    "source_investment_id" TEXT NOT NULL,
    "leg" "BinaryPosition" NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "cycle_week_start" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bv_entries_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "bv_entries" ADD CONSTRAINT "bv_entries_ancestor_user_id_fkey"
  FOREIGN KEY ("ancestor_user_id") REFERENCES "binary_nodes"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bv_entries" ADD CONSTRAINT "bv_entries_source_investment_id_fkey"
  FOREIGN KEY ("source_investment_id") REFERENCES "investments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "bv_entries_ancestor_user_id_source_investment_id_key"
  ON "bv_entries" ("ancestor_user_id", "source_investment_id");

-- CreateIndex
CREATE INDEX "bv_entries_cycle_week_start_idx" ON "bv_entries" ("cycle_week_start");
