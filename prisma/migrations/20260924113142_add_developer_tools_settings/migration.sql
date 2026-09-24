-- Admin Developer Tools: manual job triggers + a Friday-withdrawal-gate
-- testing bypass. Deliberately NOT versioned/append-only like
-- interest_rate_config/commission_config — this is mutable operational
-- testing state, updated in place, with exactly one row ever (seeded below
-- with a fixed id, no partial-unique-index trick needed since nothing ever
-- inserts a second row).

-- AlterEnum
ALTER TYPE "AdminPermission" ADD VALUE 'DEVELOPER_TOOLS';

-- AlterEnum
ALTER TYPE "AdminActionType" ADD VALUE 'FRIDAY_GATE_BYPASS_TOGGLED';

-- CreateTable
CREATE TABLE "developer_tools_settings" (
    "id" TEXT NOT NULL,
    "bypass_friday_gate" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_admin_id" TEXT,

    CONSTRAINT "developer_tools_settings_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "developer_tools_settings" ADD CONSTRAINT "developer_tools_settings_updated_by_admin_id_fkey"
  FOREIGN KEY ("updated_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed the one singleton row.
INSERT INTO "developer_tools_settings" ("id", "bypass_friday_gate", "updated_at", "updated_by_admin_id")
VALUES ('singleton', false, NOW(), NULL);
