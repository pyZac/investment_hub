-- AlterEnum
-- Adds RATE_CONFIG_SET for SCRUM-108's setInterestRate — each rate change
-- creates a brand-new versioned row (never edits an existing one), so this
-- is a "set" action type, not an "edited" one like RANK_CONFIG_EDITED.
ALTER TYPE "AdminActionType" ADD VALUE 'RATE_CONFIG_SET';

-- AlterTable
-- Who set this version — nullable because the Phase 4 seed row predates
-- this column. Unlike RankConfig's admin_actions-only attribution (no
-- direct link back to the specific config row), the rate-history screen
-- needs to show "who set each rate" directly, so a plain FK is simpler and
-- more reliable than matching admin_actions by timestamp (see
-- schema.prisma comment on InterestRateConfig.setByAdminId).
ALTER TABLE "interest_rate_config" ADD COLUMN     "set_by_admin_id" TEXT;

-- AddForeignKey
ALTER TABLE "interest_rate_config" ADD CONSTRAINT "interest_rate_config_set_by_admin_id_fkey" FOREIGN KEY ("set_by_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
