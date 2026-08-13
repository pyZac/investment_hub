-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_FAILED', 'ACCOUNT_LOCKED', 'PASSWORD_RESET_FAILED', 'SECURITY_QUESTION_FAILED');

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "user_id" TEXT,
    "email" TEXT,
    "ip_address" TEXT,
    "detail" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_events_email_created_at_idx" ON "security_events"("email", "created_at");

-- CreateIndex
CREATE INDEX "security_events_ip_address_created_at_idx" ON "security_events"("ip_address", "created_at");

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
