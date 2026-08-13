-- AlterEnum
ALTER TYPE "AdminActionType" ADD VALUE 'PASSWORD_RESET';

-- CreateTable
CREATE TABLE "security_questions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_questions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "security_questions" ADD CONSTRAINT "security_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
