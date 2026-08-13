-- CreateEnum
CREATE TYPE "PendingAuthPurpose" AS ENUM ('TOTP_VERIFICATION', 'TOTP_ENROLLMENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'TOTP_ENROLLED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TOTP_REMOVED';
ALTER TYPE "SecurityEventType" ADD VALUE 'TOTP_FAILED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_enrolled_at" TIMESTAMP(3),
ADD COLUMN     "totp_secret" TEXT;

-- CreateTable
CREATE TABLE "pending_auths" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "purpose" "PendingAuthPurpose" NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_auths_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_auths_token_hash_key" ON "pending_auths"("token_hash");

-- AddForeignKey
ALTER TABLE "pending_auths" ADD CONSTRAINT "pending_auths_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
