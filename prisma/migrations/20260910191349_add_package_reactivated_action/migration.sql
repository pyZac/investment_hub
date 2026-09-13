-- AlterEnum
-- Adds PACKAGE_REACTIVATED for SCRUM-107's reactivatePackage — the
-- deactivate/reactivate pair now mirrors the sub-admin and user lifecycle
-- pattern already established (SUBADMIN_DEACTIVATED/REACTIVATED).
ALTER TYPE "AdminActionType" ADD VALUE 'PACKAGE_REACTIVATED';
