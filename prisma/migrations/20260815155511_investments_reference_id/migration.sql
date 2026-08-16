-- AlterTable
ALTER TABLE "investments" ADD COLUMN "reference_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "investments_reference_id_key" ON "investments"("reference_id");
