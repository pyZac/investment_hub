-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'ar');

-- CreateEnum
CREATE TYPE "AdminPermission" AS ENUM ('CREDIT_ISSUANCE', 'WITHDRAWAL_APPROVAL', 'USER_MANAGEMENT', 'PACKAGE_MANAGEMENT', 'RATE_CONFIG', 'COMMISSION_CONFIG', 'RANK_CONFIG', 'LEDGER_VIEW', 'MANUAL_ADJUSTMENT', 'JOB_MONITOR', 'SOLVENCY_VIEW');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "is_main_admin" BOOLEAN NOT NULL DEFAULT false,
    "created_by_admin_id" TEXT,
    "sponsor_id" TEXT,
    "locale" "Locale" NOT NULL DEFAULT 'en',
    "suspended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_permission_grants" (
    "id" TEXT NOT NULL,
    "admin_user_id" TEXT NOT NULL,
    "permission" "AdminPermission" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_permission_grants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_permission_grants_admin_user_id_permission_key" ON "admin_permission_grants"("admin_user_id", "permission");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_admin_id_fkey" FOREIGN KEY ("created_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_sponsor_id_fkey" FOREIGN KEY ("sponsor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_permission_grants" ADD CONSTRAINT "admin_permission_grants_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce at most one main admin ever (Prisma schema cannot express partial unique indexes)
CREATE UNIQUE INDEX "users_one_main_admin" ON "users" ("is_main_admin") WHERE "is_main_admin" = true;
