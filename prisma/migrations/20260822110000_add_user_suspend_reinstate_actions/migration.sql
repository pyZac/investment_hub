-- AlterEnum
-- Adds the two admin-action types for suspendUser/reinstateUser
-- (docs/mlm_rules_log.md Section 5 / build_plan.md Phase 8 note: suspension
-- is a full financial freeze, and its ripple through leg-activity checks is
-- what SCRUM-77 exists to guard).
ALTER TYPE "AdminActionType" ADD VALUE 'USER_SUSPENDED';
ALTER TYPE "AdminActionType" ADD VALUE 'USER_REINSTATED';
