import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { hashToken } from "./token-hash";
import { requireMainAdmin, requirePermission, requireSession, AuthError } from "./route-guard";
import { login } from "./auth";
import {
  createSubAdmin,
  updateSubAdminPermissions,
  deactivateSubAdmin,
  reactivateSubAdmin,
  listSubAdmins,
  getSubAdminActionHistory,
  NotMainAdminError,
  TargetNotSubAdminError,
  CannotModifyMainAdminError,
  EmailAlreadyInUseError,
  ADMIN_PERMISSION_CATALOG,
} from "./admin-management";

const createdUserIds: string[] = [];

async function makeSubAdmin(permissions: string[] = []) {
  const subAdmin = await prisma.user.create({
    data: {
      email: `subadmin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Sub-Admin",
      role: "ADMIN",
      isMainAdmin: false,
    },
  });
  createdUserIds.push(subAdmin.id);
  if (permissions.length > 0) {
    await prisma.adminPermissionGrant.createMany({
      data: permissions.map((permission) => ({
        adminUserId: subAdmin.id,
        permission: permission as (typeof ADMIN_PERMISSION_CATALOG)[number],
      })),
    });
  }
  return subAdmin;
}

async function makePlainUser() {
  const user = await prisma.user.create({
    data: {
      email: `plainuser-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Plain User",
      role: "USER",
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function getMainAdmin() {
  return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
}

async function makeSessionToken(userId: string, forDate: Date) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(forDate.getTime() + 60 * 60 * 1000),
      lastActiveAt: forDate,
    },
  });
  return token;
}

afterAll(async () => {
  await prisma.adminAction.deleteMany({
    where: { OR: [{ targetUserId: { in: createdUserIds } }, { adminId: { in: createdUserIds } }] },
  });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("createSubAdmin", () => {
  it("main admin creates a sub-admin with permissions, logged to admin_actions", async () => {
    const mainAdmin = await getMainAdmin();

    const subAdmin = await createSubAdmin(mainAdmin.id, {
      email: `created-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "New Sub-Admin",
      permissions: ["WITHDRAWAL_APPROVAL", "LEDGER_VIEW"],
      reason: "New ops hire.",
    });
    createdUserIds.push(subAdmin.id);

    expect(subAdmin.role).toBe("ADMIN");
    expect(subAdmin.isMainAdmin).toBe(false);
    expect(subAdmin.createdByAdminId).toBe(mainAdmin.id);

    const grants = await prisma.adminPermissionGrant.findMany({ where: { adminUserId: subAdmin.id } });
    expect(grants.map((g) => g.permission).sort()).toEqual(["LEDGER_VIEW", "WITHDRAWAL_APPROVAL"]);

    const action = await prisma.adminAction.findFirstOrThrow({
      where: { targetUserId: subAdmin.id, actionType: "SUBADMIN_CREATED" },
    });
    expect(action.adminId).toBe(mainAdmin.id);
    expect(action.reason).toMatch(/new ops hire/i);
  });

  it("a sub-admin cannot create another sub-admin, even with every other permission granted", async () => {
    const subAdmin = await makeSubAdmin([...ADMIN_PERMISSION_CATALOG]);

    await expect(
      createSubAdmin(subAdmin.id, {
        email: `blocked-${crypto.randomUUID()}@test.local`,
        password: "password123",
        name: "Should Not Exist",
        permissions: [],
        reason: "Attempted escalation.",
      }),
    ).rejects.toThrow(NotMainAdminError);
  });

  it("rejects the same attempt at the route/action layer directly, via a live session token", async () => {
    const subAdmin = await makeSubAdmin([...ADMIN_PERMISSION_CATALOG]);
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    // requireMainAdmin is what the sub-admin management server actions call
    // first, before ever reaching createSubAdmin — this proves the route
    // itself rejects a sub-admin, not just the library function in isolation.
    await expect(requireMainAdmin(now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a non-admin acting user", async () => {
    const user = await makePlainUser();

    await expect(
      createSubAdmin(user.id, {
        email: `nonadmin-${crypto.randomUUID()}@test.local`,
        password: "password123",
        name: "Should Not Exist",
        permissions: [],
        reason: "Test.",
      }),
    ).rejects.toThrow(NotMainAdminError);
  });

  it("rejects a duplicate email", async () => {
    const mainAdmin = await getMainAdmin();
    const email = `dupe-${crypto.randomUUID()}@test.local`;

    const first = await createSubAdmin(mainAdmin.id, {
      email,
      password: "password123",
      name: "First",
      permissions: [],
      reason: "Initial.",
    });
    createdUserIds.push(first.id);

    await expect(
      createSubAdmin(mainAdmin.id, {
        email,
        password: "password123",
        name: "Second",
        permissions: [],
        reason: "Duplicate attempt.",
      }),
    ).rejects.toThrow(EmailAlreadyInUseError);
  });

  it("rejects an empty reason", async () => {
    const mainAdmin = await getMainAdmin();

    await expect(
      createSubAdmin(mainAdmin.id, {
        email: `noreason-${crypto.randomUUID()}@test.local`,
        password: "password123",
        name: "No Reason",
        permissions: [],
        reason: "",
      }),
    ).rejects.toThrow();
  });
});

describe("updateSubAdminPermissions", () => {
  it("assigning a permission takes effect immediately (no re-login needed)", async () => {
    const subAdmin = await makeSubAdmin();
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("WITHDRAWAL_APPROVAL", now, token)).rejects.toMatchObject({ status: 403 });

    await updateSubAdminPermissions(mainAdmin.id, subAdmin.id, {
      permissions: ["WITHDRAWAL_APPROVAL"],
      reason: "Grant for new duty.",
    });

    const resolved = await requirePermission("WITHDRAWAL_APPROVAL", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("revoking a permission takes effect immediately", async () => {
    const subAdmin = await makeSubAdmin(["WITHDRAWAL_APPROVAL"]);
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolvedBefore = await requirePermission("WITHDRAWAL_APPROVAL", now, token);
    expect(resolvedBefore.id).toBe(subAdmin.id);

    await updateSubAdminPermissions(mainAdmin.id, subAdmin.id, {
      permissions: [],
      reason: "Revoke — role change.",
    });

    await expect(requirePermission("WITHDRAWAL_APPROVAL", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("replaces the full permission set (adds and removes in one call)", async () => {
    const subAdmin = await makeSubAdmin(["WITHDRAWAL_APPROVAL", "LEDGER_VIEW"]);
    const mainAdmin = await getMainAdmin();

    const grants = await updateSubAdminPermissions(mainAdmin.id, subAdmin.id, {
      permissions: ["LEDGER_VIEW", "CREDIT_ISSUANCE"],
      reason: "Rebalance duties.",
    });

    expect(grants.map((g) => g.permission).sort()).toEqual(["CREDIT_ISSUANCE", "LEDGER_VIEW"]);
  });

  it("rejects a sub-admin acting as the grantor", async () => {
    const grantor = await makeSubAdmin();
    const target = await makeSubAdmin();

    await expect(
      updateSubAdminPermissions(grantor.id, target.id, { permissions: ["LEDGER_VIEW"], reason: "Test." }),
    ).rejects.toThrow(NotMainAdminError);
  });

  it("cannot modify the main admin's permissions", async () => {
    const mainAdmin = await getMainAdmin();

    await expect(
      updateSubAdminPermissions(mainAdmin.id, mainAdmin.id, { permissions: ["LEDGER_VIEW"], reason: "Test." }),
    ).rejects.toThrow(CannotModifyMainAdminError);
  });

  it("rejects a target that is not an admin at all", async () => {
    const mainAdmin = await getMainAdmin();
    const plainUser = await makePlainUser();

    await expect(
      updateSubAdminPermissions(mainAdmin.id, plainUser.id, { permissions: ["LEDGER_VIEW"], reason: "Test." }),
    ).rejects.toThrow(TargetNotSubAdminError);
  });
});

describe("deactivateSubAdmin / reactivateSubAdmin", () => {
  it("a deactivated sub-admin can no longer log in", async () => {
    const passwordHash = await import("./password").then((m) => m.hashPassword("password123"));
    const subAdmin = await prisma.user.create({
      data: {
        email: `deactlogin-${crypto.randomUUID()}@test.local`,
        passwordHash,
        name: "Deactivate Login Test",
        role: "ADMIN",
        isMainAdmin: false,
      },
    });
    createdUserIds.push(subAdmin.id);
    const mainAdmin = await getMainAdmin();

    await deactivateSubAdmin(mainAdmin.id, subAdmin.id, { reason: "Offboarding." });

    await expect(
      login({ email: subAdmin.email, password: "password123" }, new Date(), "10.0.0.1"),
    ).rejects.toThrow(/invalid email or password/i);
  });

  it("a deactivated sub-admin's existing session is rejected on the next request", async () => {
    const subAdmin = await makeSubAdmin(["LEDGER_VIEW"]);
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolvedBefore = await requireSession(now, token);
    expect(resolvedBefore.id).toBe(subAdmin.id);

    await deactivateSubAdmin(mainAdmin.id, subAdmin.id, { reason: "Offboarding." });

    await expect(requireSession(now, token)).rejects.toMatchObject({ status: 401 });
  });

  it("deactivating logs SUBADMIN_DEACTIVATED and is a no-op the second time", async () => {
    const subAdmin = await makeSubAdmin();
    const mainAdmin = await getMainAdmin();

    await deactivateSubAdmin(mainAdmin.id, subAdmin.id, { reason: "First." });
    const countAfterFirst = await prisma.adminAction.count({
      where: { targetUserId: subAdmin.id, actionType: "SUBADMIN_DEACTIVATED" },
    });
    expect(countAfterFirst).toBe(1);

    await deactivateSubAdmin(mainAdmin.id, subAdmin.id, { reason: "Second." });
    const countAfterSecond = await prisma.adminAction.count({
      where: { targetUserId: subAdmin.id, actionType: "SUBADMIN_DEACTIVATED" },
    });
    expect(countAfterSecond).toBe(1);
  });

  it("reactivateSubAdmin restores login ability and logs SUBADMIN_REACTIVATED", async () => {
    const subAdmin = await makeSubAdmin();
    const mainAdmin = await getMainAdmin();

    await deactivateSubAdmin(mainAdmin.id, subAdmin.id, { reason: "Temp leave." });
    const reactivated = await reactivateSubAdmin(mainAdmin.id, subAdmin.id, { reason: "Back from leave." });

    expect(reactivated.suspendedAt).toBeNull();
    const action = await prisma.adminAction.findFirstOrThrow({
      where: { targetUserId: subAdmin.id, actionType: "SUBADMIN_REACTIVATED" },
    });
    expect(action.reason).toBe("Back from leave.");
  });

  it("cannot deactivate the main admin", async () => {
    const mainAdmin = await getMainAdmin();

    await expect(
      deactivateSubAdmin(mainAdmin.id, mainAdmin.id, { reason: "Test." }),
    ).rejects.toThrow(CannotModifyMainAdminError);
  });

  it("rejects a sub-admin trying to deactivate another sub-admin", async () => {
    const actor = await makeSubAdmin();
    const target = await makeSubAdmin();

    await expect(
      deactivateSubAdmin(actor.id, target.id, { reason: "Test." }),
    ).rejects.toThrow(NotMainAdminError);
  });
});

describe("listSubAdmins", () => {
  it("main admin reaches this with no explicit grants and sees created sub-admins with their permissions", async () => {
    const mainAdmin = await getMainAdmin();
    const subAdmin = await makeSubAdmin(["JOB_MONITOR"]);

    const list = await listSubAdmins(mainAdmin.id);
    const row = list.find((s) => s.id === subAdmin.id);

    expect(row).toBeDefined();
    expect(row?.permissions).toEqual(["JOB_MONITOR"]);
    expect(list.every((s) => s.id !== mainAdmin.id)).toBe(true);
  });

  it("rejects a sub-admin caller", async () => {
    const subAdmin = await makeSubAdmin([...ADMIN_PERMISSION_CATALOG]);

    await expect(listSubAdmins(subAdmin.id)).rejects.toThrow(NotMainAdminError);
  });
});

describe("getSubAdminActionHistory", () => {
  it("returns only the given sub-admin's own admin_actions (actions they performed), not another admin's", async () => {
    const mainAdmin = await getMainAdmin();
    const subAdminA = await makeSubAdmin(["USER_MANAGEMENT"]);
    const subAdminB = await makeSubAdmin(["USER_MANAGEMENT"]);
    const targetUser = await makePlainUser();

    // Import lazily to avoid a top-level dependency this test file otherwise
    // wouldn't need — suspendUser is how a sub-admin with USER_MANAGEMENT
    // performs their OWN loggable admin_actions row (adminId = subAdminA.id).
    const { suspendUser, reinstateUser } = await import("./users");
    await suspendUser(subAdminA.id, targetUser.id, { reason: "A's action." }, new Date());
    await reinstateUser(subAdminB.id, targetUser.id, { reason: "B's action." });

    const historyA = await getSubAdminActionHistory(mainAdmin.id, subAdminA.id);

    expect(historyA.every((a) => a.adminId === subAdminA.id)).toBe(true);
    expect(historyA.some((a) => a.reason === "A's action.")).toBe(true);
    expect(historyA.some((a) => a.reason === "B's action.")).toBe(false);
  });

  it("rejects a non-main-admin caller", async () => {
    const subAdmin = await makeSubAdmin([...ADMIN_PERMISSION_CATALOG]);
    const other = await makeSubAdmin();

    await expect(getSubAdminActionHistory(subAdmin.id, other.id)).rejects.toThrow(NotMainAdminError);
  });
});
