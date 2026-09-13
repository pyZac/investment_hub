-- SCRUM-110: rank rules management UI.

-- AlterTable: who set this version (mirrors interest_rate_config.set_by_admin_id
-- / commission_config.set_by_admin_id from SCRUM-108/109 — a direct FK so the
-- history view can show "who changed each version" without matching
-- admin_actions by timestamp/reason text). Nullable because every
-- pre-SCRUM-110 row predates this column.
ALTER TABLE "rank_config" ADD COLUMN "set_by_admin_id" TEXT;
ALTER TABLE "rank_config" ADD CONSTRAINT "rank_config_set_by_admin_id_fkey"
  FOREIGN KEY ("set_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
