-- CreateTable
-- Weekly weak-leg payout snapshot, one row per user per cycle (Saturday
-- 00:00 -> Friday 23:59, Asia/Dubai) — the audit record and UI data source
-- for "why wasn't I paid" (docs/phases/phase-08-binary-cycle.md). Schema
-- only for now; the cycle-close engine that populates these rows is a
-- later ticket. idempotency_key is a dedicated unique column
-- (binary:{user_id}:{week_start} format), matching the wallet_transfers/
-- withdrawal_requests pattern, in addition to the natural
-- UNIQUE(user_id, week_start) below.
CREATE TABLE "binary_cycles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "week_start" TIMESTAMP(3) NOT NULL,
    "week_end" TIMESTAMP(3) NOT NULL,
    "left_volume" DECIMAL(24,8) NOT NULL,
    "right_volume" DECIMAL(24,8) NOT NULL,
    "matched_volume" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "commission_paid" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "carry_left" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "carry_right" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "carry_left_since" TIMESTAMP(3),
    "carry_right_since" TIMESTAMP(3),
    "qualified" BOOLEAN NOT NULL,
    "qualification_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "binary_cycles_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "binary_cycles" ADD CONSTRAINT "binary_cycles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
CREATE UNIQUE INDEX "binary_cycles_user_id_week_start_key"
  ON "binary_cycles" ("user_id", "week_start");

-- CreateIndex
CREATE UNIQUE INDEX "binary_cycles_idempotency_key_key"
  ON "binary_cycles" ("idempotency_key");

-- CreateIndex
CREATE INDEX "binary_cycles_week_start_idx" ON "binary_cycles" ("week_start");
