-- CreateTable
CREATE TABLE "commission_config" (
    "id" TEXT NOT NULL,
    "direct_rate" DECIMAL(24,8) NOT NULL,
    "direct_commission_split" DECIMAL(24,8) NOT NULL,
    "direct_saving_split" DECIMAL(24,8) NOT NULL,
    "binary_rate" DECIMAL(24,8) NOT NULL,
    "binary_carry_forward_expiry_months" INTEGER NOT NULL DEFAULT 6,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Partial unique index on a constant expression (TRUE), not on effective_to
-- itself — Postgres treats every NULL as distinct even in a partial index, so
-- indexing the nullable column can never catch a second active row. Same
-- pattern as interest_rate_config (see tasks/lessons.md, Phase 4 entry).
CREATE UNIQUE INDEX "commission_config_one_active"
  ON "commission_config" ((TRUE))
  WHERE "effective_to" IS NULL;

-- Seed: direct 8% (5% commission / 3% saving split), binary 8%, 6-month carry-forward expiry.
INSERT INTO "commission_config"
  ("id", "direct_rate", "direct_commission_split", "direct_saving_split", "binary_rate", "binary_carry_forward_expiry_months", "effective_from", "effective_to")
VALUES
  ('seed-commission-config-v1', 8.00000000, 5.00000000, 3.00000000, 8.00000000, 6, CURRENT_TIMESTAMP, NULL);
