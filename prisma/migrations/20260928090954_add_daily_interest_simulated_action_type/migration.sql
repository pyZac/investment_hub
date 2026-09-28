-- Developer Tools: "Simulate N days of Daily Interest" for one
-- admin-chosen investment (never a platform-wide sweep — see this
-- migration's companion lib code for why that distinction matters).

-- AlterEnum
ALTER TYPE "AdminActionType" ADD VALUE 'DAILY_INTEREST_SIMULATED';
