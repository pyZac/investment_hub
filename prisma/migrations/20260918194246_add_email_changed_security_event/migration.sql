-- AlterEnum
ALTER TYPE "SecurityEventType" ADD VALUE 'EMAIL_CHANGED';

-- DropForeignKey
ALTER TABLE "binary_nodes" DROP CONSTRAINT "binary_nodes_parent_id_fkey";

-- AddForeignKey
ALTER TABLE "binary_nodes" ADD CONSTRAINT "binary_nodes_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "binary_nodes"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
