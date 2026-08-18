-- CreateEnum
CREATE TYPE "TransferFromWallet" AS ENUM ('A', 'C');

-- CreateTable
CREATE TABLE "wallet_transfers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "from_wallet" "TransferFromWallet" NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL,
    "idempotency_key" TEXT NOT NULL,

    CONSTRAINT "wallet_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_transfers_idempotency_key_key" ON "wallet_transfers"("idempotency_key");

-- CreateIndex
CREATE INDEX "wallet_transfers_user_id_idx" ON "wallet_transfers"("user_id");

-- AddForeignKey
ALTER TABLE "wallet_transfers" ADD CONSTRAINT "wallet_transfers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
