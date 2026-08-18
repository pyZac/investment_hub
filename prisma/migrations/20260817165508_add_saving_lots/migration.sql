-- CreateTable
CREATE TABLE "saving_lots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "source_investment_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlocks_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "saving_lots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saving_lots_user_id_idx" ON "saving_lots"("user_id");

-- CreateIndex
CREATE INDEX "saving_lots_released_at_unlocks_at_idx" ON "saving_lots"("released_at", "unlocks_at");

-- AddForeignKey
ALTER TABLE "saving_lots" ADD CONSTRAINT "saving_lots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
