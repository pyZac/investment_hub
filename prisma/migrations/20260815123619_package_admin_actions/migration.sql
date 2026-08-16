-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AdminActionType" ADD VALUE 'PACKAGE_CREATED';
ALTER TYPE "AdminActionType" ADD VALUE 'PACKAGE_EDITED';
ALTER TYPE "AdminActionType" ADD VALUE 'PACKAGE_DEACTIVATED';

-- AlterTable
ALTER TABLE "admin_actions" ADD COLUMN     "target_package_id" TEXT;

-- AddForeignKey
ALTER TABLE "admin_actions" ADD CONSTRAINT "admin_actions_target_package_id_fkey" FOREIGN KEY ("target_package_id") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
