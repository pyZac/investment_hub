-- CreateTable
CREATE TABLE "interest_rate_config" (
    "id" TEXT NOT NULL,
    "monthly_rate" DECIMAL(24,8) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interest_rate_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Partial unique index: at most one row may have effective_to IS NULL at a
-- time, i.e. exactly one "currently active" rate can exist. A plain @@unique
-- can't express the WHERE clause, so this is hand-written (see schema.prisma
-- comment on InterestRateConfig).
CREATE UNIQUE INDEX "interest_rate_config_one_active"
  ON "interest_rate_config" ("effective_to")
  WHERE "effective_to" IS NULL;

-- Seed the current 5% monthly rate as the initial active row.
INSERT INTO "interest_rate_config" ("id", "monthly_rate", "effective_from", "effective_to")
VALUES ('seed-interest-rate-5pct', 5.00000000, CURRENT_TIMESTAMP, NULL);
