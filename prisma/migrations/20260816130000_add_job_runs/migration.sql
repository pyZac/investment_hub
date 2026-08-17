-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "period_key" TEXT NOT NULL,
    "status" "JobRunStatus" NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_job_type_period_key_key" ON "job_runs"("job_type", "period_key");
