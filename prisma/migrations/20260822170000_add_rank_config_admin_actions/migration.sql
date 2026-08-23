-- AlterEnum
-- Adds the two admin-action types for createRankConfig/editRankConfig
-- (SCRUM-87). No dedicated target*Id FK exists for rank_config on
-- admin_actions (unlike targetPackageId for packages) — the rank name and
-- new values are logged in the existing nullable `reason` text field
-- instead of adding a new FK column.
ALTER TYPE "AdminActionType" ADD VALUE 'RANK_CONFIG_CREATED';
ALTER TYPE "AdminActionType" ADD VALUE 'RANK_CONFIG_EDITED';
