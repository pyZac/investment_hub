import type { AdminActionType, SecurityEventType } from "@prisma/client";
import { prisma } from "./prisma";

const PLATFORM_LABEL = "System";
const PAGE_SIZE = 50;
/**
 * Safety cap on how many rows are pulled from EACH source before merging
 * and paginating in memory — this is an internal simulation with a
 * bounded, small event volume (same reasoning as EXPORT_ROW_LIMIT in
 * ledger-explorer.ts), not a true streaming pagination design. Large enough
 * that any realistic filtered result set for this project fits inside it,
 * so merged pagination is always correct (never short a page because one
 * source's fetch window ran out before the other's).
 */
const FETCH_LIMIT = 5_000;

async function assertHasSecurityViewPermission(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }
  if (admin.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "SECURITY_VIEW" } },
  });
  if (!grant) {
    throw new Error("Forbidden: missing SECURITY_VIEW permission.");
  }
}

/**
 * Readable labels for SecurityEventType — same pattern as
 * ENTRY_TYPE_LABELS in transaction-history.ts, kept in English in both
 * locales (financial/security terminology, per the bilingual-rtl skill).
 */
export const SECURITY_EVENT_TYPE_LABELS: Record<SecurityEventType, string> = {
  LOGIN_FAILED: "Failed Login",
  ACCOUNT_LOCKED: "Account Locked",
  PASSWORD_RESET_FAILED: "Password Reset Failed",
  SECURITY_QUESTION_FAILED: "Security Question Failed",
  TOTP_ENROLLED: "2FA Enrolled",
  TOTP_REMOVED: "2FA Removed",
  TOTP_FAILED: "2FA Failed",
  EMAIL_CHANGED: "Email Changed",
};

/**
 * Readable labels for AdminActionType — mirrors the per-screen
 * `actionType_*` translation keys already used by the sub-admin action log
 * (src/app/[locale]/admin/sub-admins/sub-admin-action-log.tsx), but as a
 * single shared source so this screen and that one never drift on wording.
 */
export const ADMIN_ACTION_TYPE_LABELS: Record<AdminActionType, string> = {
  USER_CREATED: "User Created",
  PASSWORD_RESET: "Password Reset",
  CREDIT_ISSUANCE: "Admin Credit",
  PACKAGE_CREATED: "Package Created",
  PACKAGE_EDITED: "Package Edited",
  PACKAGE_DEACTIVATED: "Package Deactivated",
  PACKAGE_REACTIVATED: "Package Reactivated",
  USER_SUSPENDED: "User Suspended",
  USER_REINSTATED: "User Reinstated",
  RANK_CONFIG_CREATED: "Rank Config Created",
  RANK_CONFIG_EDITED: "Rank Config Edited",
  RATE_CONFIG_SET: "Interest Rate Set",
  COMMISSION_CONFIG_SET: "Commission Config Set",
  MANUAL_ADJUSTMENT_POSTED: "Manual Adjustment Posted",
  JOB_MONITOR_TRIGGERED: "Job Manually Triggered",
  SUBADMIN_CREATED: "Sub-Admin Created",
  SUBADMIN_PERMISSIONS_UPDATED: "Permissions Updated",
  SUBADMIN_DEACTIVATED: "Sub-Admin Deactivated",
  SUBADMIN_REACTIVATED: "Sub-Admin Reactivated",
};

export type SecurityLogSource = "SECURITY_EVENT" | "ADMIN_ACTION";

export type SecurityLogRow = {
  /** `security_event:<id>` or `admin_action:<id>` — unique across both sources. */
  id: string;
  source: SecurityLogSource;
  createdAt: Date;
  typeLabel: string;
  /** The user the event concerns — the security event's own user/email, or
   * the admin action's target user; "System" when neither applies (e.g. an
   * admin action with no specific target user). */
  userLabel: string;
  /** The acting admin's name, only for ADMIN_ACTION rows — null for
   * SECURITY_EVENT rows, which have no "acting admin" concept. */
  actorLabel: string | null;
  detail: string | null;
};

export type SecurityLogFilters = {
  source?: SecurityLogSource;
  userId?: string;
  dateFrom?: Date;
  dateTo?: Date;
};

function createdAtWhere(filters: SecurityLogFilters) {
  if (!filters.dateFrom && !filters.dateTo) return undefined;
  return {
    ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
    ...(filters.dateTo ? { lte: filters.dateTo } : {}),
  };
}

async function fetchSecurityEventRows(filters: SecurityLogFilters): Promise<SecurityLogRow[]> {
  if (filters.source === "ADMIN_ACTION") return [];

  const createdAt = createdAtWhere(filters);
  const events = await prisma.securityEvent.findMany({
    where: {
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: FETCH_LIMIT,
    include: { user: { select: { name: true } } },
  });

  return events.map((e) => ({
    id: `security_event:${e.id}`,
    source: "SECURITY_EVENT" as const,
    createdAt: e.createdAt,
    typeLabel: SECURITY_EVENT_TYPE_LABELS[e.type],
    userLabel: e.user?.name ?? e.email ?? PLATFORM_LABEL,
    actorLabel: null,
    detail: e.detail,
  }));
}

async function fetchAdminActionRows(filters: SecurityLogFilters): Promise<SecurityLogRow[]> {
  if (filters.source === "SECURITY_EVENT") return [];

  const createdAt = createdAtWhere(filters);
  const actions = await prisma.adminAction.findMany({
    where: {
      ...(filters.userId ? { targetUserId: filters.userId } : {}),
      ...(createdAt ? { createdAt } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: FETCH_LIMIT,
    include: {
      admin: { select: { name: true } },
      targetUser: { select: { name: true } },
    },
  });

  return actions.map((a) => ({
    id: `admin_action:${a.id}`,
    source: "ADMIN_ACTION" as const,
    createdAt: a.createdAt,
    typeLabel: ADMIN_ACTION_TYPE_LABELS[a.actionType],
    userLabel: a.targetUser?.name ?? PLATFORM_LABEL,
    actorLabel: a.admin.name,
    detail: a.reason,
  }));
}

/**
 * Merged, filterable, chronological feed of security_events and
 * admin_actions (SCRUM-119) — SECURITY_VIEW-gated (main admin bypass, per
 * invariant #8). Reads both tables directly; no new table, no write path.
 * `userId` filters security_events by its own user (the account the event
 * concerns) and admin_actions by targetUserId (the account acted upon) —
 * the same "who does this event concern" semantics from each table's own
 * shape, just applied uniformly across both sources.
 *
 * Pagination fetches PAGE_SIZE from each source independently, merges, then
 * re-sorts and slices — simpler than a single SQL UNION across two Prisma
 * models with different shapes, and correct for this project's actual data
 * volume (an internal simulation, not high-throughput production traffic).
 */
export async function querySecurityLog(
  actingAdminId: string,
  filters: SecurityLogFilters,
  page: number,
): Promise<{ rows: SecurityLogRow[]; total: number }> {
  await assertHasSecurityViewPermission(actingAdminId);

  const [securityRows, adminRows] = await Promise.all([
    fetchSecurityEventRows(filters),
    fetchAdminActionRows(filters),
  ]);

  const merged = [...securityRows, ...adminRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const start = (page - 1) * PAGE_SIZE;
  const rows = merged.slice(start, start + PAGE_SIZE);

  return { rows, total: merged.length };
}

export { PAGE_SIZE };
