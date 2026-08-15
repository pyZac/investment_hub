-- CreateTable
CREATE TABLE "wallets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "Wallet" NOT NULL,
    "balance" DECIMAL(24,8) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallets_user_id_type_key" ON "wallets"("user_id", "type");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CheckConstraint: SYSTEM_EXTERNAL is a ledger-only concept (not a real user), never a row here
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_type_not_system_external" CHECK ("type" != 'SYSTEM_EXTERNAL');
