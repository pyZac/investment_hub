import { z } from "zod";
import type { AdminPermission } from "@prisma/client";
import { prisma } from "./prisma";
import { hashPassword } from "./password";

const ADMIN_PERMISSION_CATALOG: AdminPermission[] = [
  "CREDIT_ISSUANCE",
  "WITHDRAWAL_APPROVAL",
  "USER_MANAGEMENT",
  "PACKAGE_MANAGEMENT",
  "RATE_CONFIG",
  "COMMISSION_CONFIG",
  "RANK_CONFIG",
  "LEDGER_VIEW",
  "MANUAL_ADJUSTMENT",
  "JOB_MONITOR",
  "SOLVENCY_VIEW",
  "SECURITY_VIEW",
];

export class NotMainAdminError extends Error {
  constructor() {
    super("Forbidden: only the main admin can manage sub-admin accounts.");
    this.name = "NotMainAdminError";
  }
}

export class TargetNotSubAdminError extends Error {
  constructor() {
    super("Target account is not a sub-admin.");
    this.name = "TargetNotSubAdminError";
  }
}

export class CannotModifyMainAdminError extends Error {
  constructor() {
    super("The main admin account cannot be modified through sub-admin management.");
    this.name = "CannotModifyMainAdminError";
  }
}

export class EmailAlreadyInUseError extends Error {
  constructor() {
    super("An account with this email already exists.");
    this.name = "EmailAlreadyInUseError";
  }
}

/**
 * Every function in this module re-verifies the acting admin is the main
 * admin, even though the route/action layer (route-guard.ts's
 * requireMainAdmin) already enforces this before calling in — the same
 * defense-in-depth pattern as assertHasUserManagementPermission in users.ts.
 * Admin account management is deliberately NOT part of the grantable
 * AdminPermission catalog (invariant #8 / build_plan.md's Admin Roles
 * section): a sub-admin can never reach these functions no matter what
 * permissions they hold, because there is no permission value that grants
 * this surface, only main-admin status itself.
 */
async function assertActingUserIsMainAdmin(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN" || !admin.isMainAdmin) {
    throw new NotMainAdminError();
  }
}

function assertKnownPermissions(permissions: AdminPermission[]): void {
  for (const permission of permissions) {
    if (!ADMIN_PERMISSION_CATALOG.includes(permission)) {
      throw new Error(`Unknown permission: ${permission}`);
    }
  }
}

const createSubAdminInputSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1),
  permissions: z.array(z.string()).default([]),
  reason: z.string().min(1, "A reason is required for creating a sub-admin account."),
});

export type CreateSubAdminInput = z.infer<typeof createSubAdminInputSchema>;

/**
 * Creates a sub-admin account: role ADMIN, isMainAdmin false. No wallets are
 * created (admin accounts are not financial actors in the simulation, unlike
 * regular users — mirrors the fact that no existing admin-creation path in
 * this codebase calls createWalletsForUser). TOTP enrollment happens on
 * first login, same as any other admin account (auth.ts's login() already
 * forces this for every role: ADMIN row, sub-admins included).
 */
export async function createSubAdmin(actingAdminId: string, input: CreateSubAdminInput) {
  await assertActingUserIsMainAdmin(actingAdminId);
  const data = createSubAdminInputSchema.parse(input);
  const permissions = [...new Set(data.permissions)] as AdminPermission[];
  assertKnownPermissions(permissions);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    throw new EmailAlreadyInUseError();
  }

  const passwordHash = await hashPassword(data.password);

  return prisma.$transaction(async (tx) => {
    const subAdmin = await tx.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
        role: "ADMIN",
        isMainAdmin: false,
        createdByAdminId: actingAdminId,
      },
    });

    if (permissions.length > 0) {
      await tx.adminPermissionGrant.createMany({
        data: permissions.map((permission) => ({ adminUserId: subAdmin.id, permission })),
      });
    }

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "SUBADMIN_CREATED",
        targetUserId: subAdmin.id,
        reason: permissions.length > 0 ? `${data.reason} (permissions: ${permissions.join(", ")})` : data.reason,
      },
    });

    return subAdmin;
  });
}

async function getTargetSubAdmin(subAdminId: string) {
  const target = await prisma.user.findUniqueOrThrow({ where: { id: subAdminId } });
  if (target.isMainAdmin) {
    throw new CannotModifyMainAdminError();
  }
  if (target.role !== "ADMIN") {
    throw new TargetNotSubAdminError();
  }
  return target;
}

const updateSubAdminPermissionsInputSchema = z.object({
  permissions: z.array(z.string()),
  reason: z.string().min(1, "A reason is required for changing a sub-admin's permissions."),
});

/**
 * Replaces the sub-admin's permission set with exactly the given list —
 * diffs against current grants and creates/deletes only what changed.
 * Effective immediately: route-guard.ts's requirePermission re-reads
 * admin_permission_grants live on every call, no session-cached copy exists
 * to invalidate.
 */
export async function updateSubAdminPermissions(
  actingAdminId: string,
  subAdminId: string,
  input: z.infer<typeof updateSubAdminPermissionsInputSchema>,
) {
  await assertActingUserIsMainAdmin(actingAdminId);
  const data = updateSubAdminPermissionsInputSchema.parse(input);
  const desired = [...new Set(data.permissions)] as AdminPermission[];
  assertKnownPermissions(desired);

  await getTargetSubAdmin(subAdminId);

  const currentGrants = await prisma.adminPermissionGrant.findMany({
    where: { adminUserId: subAdminId },
    select: { permission: true },
  });
  const current = new Set(currentGrants.map((g) => g.permission));
  const desiredSet = new Set(desired);

  const toAdd = desired.filter((p) => !current.has(p));
  const toRemove = [...current].filter((p) => !desiredSet.has(p));

  return prisma.$transaction(async (tx) => {
    if (toAdd.length > 0) {
      await tx.adminPermissionGrant.createMany({
        data: toAdd.map((permission) => ({ adminUserId: subAdminId, permission })),
      });
    }
    if (toRemove.length > 0) {
      await tx.adminPermissionGrant.deleteMany({
        where: { adminUserId: subAdminId, permission: { in: toRemove } },
      });
    }

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "SUBADMIN_PERMISSIONS_UPDATED",
        targetUserId: subAdminId,
        reason: `${data.reason} (now: ${desired.length > 0 ? desired.join(", ") : "none"})`,
      },
    });

    return tx.adminPermissionGrant.findMany({ where: { adminUserId: subAdminId } });
  });
}

const reasonInputSchema = z.object({
  reason: z.string().min(1, "A reason is required."),
});

/**
 * Deactivates a sub-admin by setting suspendedAt — the same flag/mechanism
 * used for regular-user suspension. This blocks login (auth.ts's login()
 * already checks !user.suspendedAt) and immediately invalidates any live
 * session (route-guard.ts's requireSession destroys the session and throws
 * the moment it sees suspendedAt set, on the very next request). No-op if
 * already deactivated, mirroring suspendUser's existing idempotent-adjacent
 * -state convention.
 */
export async function deactivateSubAdmin(
  actingAdminId: string,
  subAdminId: string,
  input: z.infer<typeof reasonInputSchema>,
) {
  await assertActingUserIsMainAdmin(actingAdminId);
  const data = reasonInputSchema.parse(input);
  const target = await getTargetSubAdmin(subAdminId);

  if (target.suspendedAt !== null) {
    return target;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: subAdminId },
      data: { suspendedAt: new Date() },
    });
    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "SUBADMIN_DEACTIVATED",
        targetUserId: subAdminId,
        reason: data.reason,
      },
    });
    return updated;
  });
}

/**
 * Reverses deactivateSubAdmin. No-op if already active.
 */
export async function reactivateSubAdmin(
  actingAdminId: string,
  subAdminId: string,
  input: z.infer<typeof reasonInputSchema>,
) {
  await assertActingUserIsMainAdmin(actingAdminId);
  const data = reasonInputSchema.parse(input);
  const target = await getTargetSubAdmin(subAdminId);

  if (target.suspendedAt === null) {
    return target;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: subAdminId },
      data: { suspendedAt: null },
    });
    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "SUBADMIN_REACTIVATED",
        targetUserId: subAdminId,
        reason: data.reason,
      },
    });
    return updated;
  });
}

/**
 * Every non-main-admin ADMIN-role user, with their current permission
 * grants — the roster the sub-admin management screen renders. Main-admin
 * -only (invariant #8: this whole surface is gated on isMainAdmin, not a
 * grantable permission).
 */
export async function listSubAdmins(actingAdminId: string) {
  await assertActingUserIsMainAdmin(actingAdminId);

  const subAdmins = await prisma.user.findMany({
    where: { role: "ADMIN", isMainAdmin: false },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
      suspendedAt: true,
      permissionGrants: { select: { permission: true } },
    },
  });

  return subAdmins.map((s) => ({
    id: s.id,
    email: s.email,
    name: s.name,
    createdAt: s.createdAt,
    suspendedAt: s.suspendedAt,
    permissions: s.permissionGrants.map((g) => g.permission),
  }));
}

/**
 * A single sub-admin's own admin_actions history (invariant #9-adjacent:
 * ownership here means "this admin's own actions", scoped by adminId, not a
 * client-supplied arbitrary filter) — newest first.
 */
export async function getSubAdminActionHistory(actingAdminId: string, subAdminId: string) {
  await assertActingUserIsMainAdmin(actingAdminId);
  await getTargetSubAdmin(subAdminId);

  return prisma.adminAction.findMany({
    where: { adminId: subAdminId },
    orderBy: { createdAt: "desc" },
  });
}

export { ADMIN_PERMISSION_CATALOG };
