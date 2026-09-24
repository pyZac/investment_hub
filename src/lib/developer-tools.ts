import { prisma } from "./prisma";
import { DEVELOPER_TOOLS_SETTINGS_ID } from "./developer-tools-constants";
import { listJobStatuses, triggerJobRun } from "./job-monitor";

async function assertHasDeveloperToolsPermission(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }
  if (admin.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "DEVELOPER_TOOLS" } },
  });
  if (!grant) {
    throw new Error("Forbidden: missing DEVELOPER_TOOLS permission.");
  }
}

export type FridayBypassStatus = {
  enabled: boolean;
  updatedAt: Date;
  updatedByAdminName: string | null;
};

/**
 * Current state of the Friday-withdrawal-gate testing bypass — the same
 * singleton row `assertFriday` (withdrawal-guard.ts) itself reads. Read-only,
 * DEVELOPER_TOOLS-gated.
 */
export async function getFridayBypassStatus(actingAdminId: string): Promise<FridayBypassStatus> {
  await assertHasDeveloperToolsPermission(actingAdminId);

  const settings = await prisma.developerToolsSetting.findUniqueOrThrow({
    where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
    include: { updatedByAdmin: { select: { name: true } } },
  });

  return {
    enabled: settings.bypassFridayGate,
    updatedAt: settings.updatedAt,
    updatedByAdminName: settings.updatedByAdmin?.name ?? null,
  };
}

/**
 * Toggles the Friday-withdrawal-gate testing bypass. DEVELOPER_TOOLS-gated.
 * Logs `FRIDAY_GATE_BYPASS_TOGGLED` to admin_actions so turning this on/off
 * is attributable and auditable — this flag controls a real production
 * financial safety gate (A->B profit transfer, capital release, and B-exit
 * submission all skip their Friday check while it's on), not a cosmetic
 * setting.
 *
 * No `forDate` parameter (unlike most admin actions in this codebase):
 * there is no business-meaningful date this function writes — `updatedAt`
 * is `@updatedAt`-tracked by Prisma itself, and `admin_actions.createdAt`
 * defaults to `now()` like every other admin-action log call site in this
 * codebase (none of them pass a caller-supplied date either). Matches
 * `reinstateUser`'s signature in users.ts, which drops `forDate` for the
 * same reason (no field to set from it) while `suspendUser` keeps it
 * (writes `suspendedAt: forDate`).
 */
export async function setFridayBypass(actingAdminId: string, enabled: boolean): Promise<void> {
  await assertHasDeveloperToolsPermission(actingAdminId);

  await prisma.$transaction([
    prisma.developerToolsSetting.update({
      where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
      data: { bypassFridayGate: enabled, updatedByAdminId: actingAdminId },
    }),
    prisma.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "FRIDAY_GATE_BYPASS_TOGGLED",
        reason: `Friday withdrawal gate testing bypass turned ${enabled ? "ON" : "OFF"}.`,
      },
    }),
  ]);
}

/**
 * The Developer Tools page's job-trigger section is a consumer of
 * job-monitor.ts, not a fork of it — same JOB_MONITOR permission check,
 * same catch-up functions the real cron worker calls, same audit log
 * entry type (JOB_MONITOR_TRIGGERED). Re-exported here so the page's own
 * actions.ts has one import surface for everything Developer Tools needs,
 * without duplicating job-monitor.ts's logic.
 */
export { listJobStatuses, triggerJobRun };
