-- AlterEnum
-- Adds the four admin-action types for SCRUM-103's sub-admin management
-- (createSubAdmin/updateSubAdminPermissions/deactivateSubAdmin/reactivateSubAdmin).
-- No dedicated target column for the permission list — like RANK_CONFIG_CREATED/
-- RANK_CONFIG_EDITED before it, the changed permission set is logged in the
-- existing nullable `reason` text field; targetUserId already points at the
-- affected sub-admin.
ALTER TYPE "AdminActionType" ADD VALUE 'SUBADMIN_CREATED';
ALTER TYPE "AdminActionType" ADD VALUE 'SUBADMIN_PERMISSIONS_UPDATED';
ALTER TYPE "AdminActionType" ADD VALUE 'SUBADMIN_DEACTIVATED';
ALTER TYPE "AdminActionType" ADD VALUE 'SUBADMIN_REACTIVATED';
