-- CreateEnum
CREATE TYPE "Wallet" AS ENUM ('A', 'B', 'C', 'SAVING', 'SYSTEM_EXTERNAL');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('ADMIN_CREDIT', 'PACKAGE_PURCHASE', 'DAILY_INTEREST', 'DIRECT_COMMISSION', 'DIRECT_SAVING', 'BINARY_COMMISSION', 'RANK_REWARD', 'WITHDRAWAL_OUT', 'WITHDRAWAL_IN', 'CAPITAL_RELEASE', 'SAVING_UNLOCK', 'ADMIN_ADJUSTMENT');

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "wallet" "Wallet" NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "comment" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_entries_user_id_wallet_idx" ON "ledger_entries"("user_id", "wallet");

-- CreateIndex
CREATE INDEX "ledger_entries_reference_type_reference_id_idx" ON "ledger_entries"("reference_type", "reference_id");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CheckConstraint: amount is always positive; direction (CREDIT/DEBIT) carries the sign
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amount_positive" CHECK ("amount" > 0);

-- Append-only enforcement: ledger_entries has no UPDATE/DELETE, ever (Invariant #2).
-- The app connects as the table owner (postgres), so REVOKE has no effect on it —
-- a trigger blocks the operation regardless of role, including the owner's own queries.
CREATE OR REPLACE FUNCTION ledger_entries_block_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only: % is not allowed', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entries_no_update
  BEFORE UPDATE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_block_mutation();

CREATE TRIGGER ledger_entries_no_delete
  BEFORE DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_block_mutation();
