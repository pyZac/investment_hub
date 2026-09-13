-- SCRUM-109: commission rules management UI.

-- AlterEnum
ALTER TYPE "AdminActionType" ADD VALUE 'COMMISSION_CONFIG_SET';

-- AlterTable: who set this version (mirrors interest_rate_config.set_by_admin_id
-- from SCRUM-108 — a direct FK so the history view can show "who set each
-- version" without matching admin_actions by timestamp). Nullable because the
-- Phase 5 seed row predates this column.
ALTER TABLE "commission_config" ADD COLUMN "set_by_admin_id" TEXT;
ALTER TABLE "commission_config" ADD CONSTRAINT "commission_config_set_by_admin_id_fkey"
  FOREIGN KEY ("set_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data migration: direct_commission_split / direct_saving_split are being
-- reinterpreted from "independent % of investment amount" (5, 3) to
-- "% of direct_rate that must sum to 100" (62.5, 37.5 of direct_rate=8) — the
-- same effective payout (8 * 62.5% = 5, 8 * 37.5% = 3), just re-expressed so
-- the admin UI can enforce a real "must sum to 100%" invariant on the two
-- fields. Only converts rows where the OLD interpretation is still in effect
-- (split values that don't already sum to 100, i.e. every row written before
-- this migration) — safe to run exactly once.
UPDATE "commission_config"
SET
  "direct_commission_split" = ROUND("direct_commission_split" / "direct_rate" * 100, 8),
  "direct_saving_split" = ROUND("direct_saving_split" / "direct_rate" * 100, 8)
WHERE ROUND("direct_commission_split" + "direct_saving_split", 8) <> 100.00000000;
