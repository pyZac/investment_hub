-- AlterEnum
ALTER TYPE "AdminActionType" ADD VALUE 'MARKETER_STATUS_CHANGED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_marketer" BOOLEAN NOT NULL DEFAULT false;
