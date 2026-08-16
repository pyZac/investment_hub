-- CreateEnum
CREATE TYPE "InvestmentStatus" AS ENUM ('ACTIVE', 'CAPITAL_RELEASED');

-- CreateTable
CREATE TABLE "investments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "package_id" TEXT NOT NULL,
    "amount" DECIMAL(24,8) NOT NULL,
    "purchased_at" TIMESTAMP(3) NOT NULL,
    "profit_starts_at" TIMESTAMP(3) NOT NULL,
    "capital_unlocks_at" TIMESTAMP(3) NOT NULL,
    "capital_released_at" TIMESTAMP(3),
    "status" "InvestmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "investments_user_id_idx" ON "investments"("user_id");

-- CreateIndex
CREATE INDEX "investments_package_id_idx" ON "investments"("package_id");

-- AddForeignKey
ALTER TABLE "investments" ADD CONSTRAINT "investments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "investments" ADD CONSTRAINT "investments_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
