import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { hashToken } from "./token-hash";
import {
  AuthError,
  requireSession,
  requireAdmin,
  requirePermission,
  requireMainAdmin,
} from "./route-guard";

const createdUserIds: string[] = [];

async function makeUser(overrides: {
  role?: "USER" | "ADMIN";
  isMainAdmin?: boolean;
  suspended?: boolean;
} = {}) {
  const user = await prisma.user.create({
    data: {
      email: `guard-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Route Guard Test User",
      role: overrides.role ?? "USER",
      isMainAdmin: overrides.isMainAdmin ?? false,
      suspendedAt: overrides.suspended ? new Date() : null,
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
  const mainAdmin = await prisma.user.findFirst({ where: { isMainAdmin: true } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({
    where: { userId: { in: mainAdmin ? [...createdUserIds, mainAdmin.id] : createdUserIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("requireSession", () => {
  it("returns the user for a valid token", async () => {
    const user = await makeUser();
    const now = new Date();
    const token = await makeSessionToken(user.id, now);

    const resolved = await requireSession(now, token);
    expect(resolved.id).toBe(user.id);
  });

  it("rejects a missing token", async () => {
    // "" (not undefined) simulates "no cookie present" without falling through
    // to the real cookies() call, which requires a live Next.js request scope.
    await expect(requireSession(new Date(), "")).rejects.toThrow(AuthError);
  });

  it("rejects an unknown token", async () => {
    await expect(requireSession(new Date(), "not-a-real-token")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rejects and destroys the session for a suspended user", async () => {
    const user = await makeUser({ suspended: true });
    const now = new Date();
    const token = await makeSessionToken(user.id, now);

    await expect(requireSession(now, token)).rejects.toMatchObject({ status: 401 });

    const remaining = await prisma.session.count({ where: { userId: user.id } });
    expect(remaining).toBe(0);
  });
});

describe("requireAdmin", () => {
  it("allows an admin", async () => {
    const admin = await makeUser({ role: "ADMIN" });
    const now = new Date();
    const token = await makeSessionToken(admin.id, now);

    const resolved = await requireAdmin(now, token);
    expect(resolved.id).toBe(admin.id);
  });

  it("rejects a regular user", async () => {
    const user = await makeUser({ role: "USER" });
    const now = new Date();
    const token = await makeSessionToken(user.id, now);

    await expect(requireAdmin(now, token)).rejects.toMatchObject({ status: 403 });
  });
});

describe("requirePermission", () => {
  it("main admin bypasses every permission with no explicit grant", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("CREDIT_ISSUANCE", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });

  it("sub-admin without the specific grant is rejected", async () => {
    const subAdmin = await makeUser({ role: "ADMIN" });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("CREDIT_ISSUANCE", now, token)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("sub-admin with the specific grant is allowed", async () => {
    const subAdmin = await makeUser({ role: "ADMIN" });
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "CREDIT_ISSUANCE" },
    });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("CREDIT_ISSUANCE", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("a grant for one permission does not authorize a different permission", async () => {
    const subAdmin = await makeUser({ role: "ADMIN" });
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "CREDIT_ISSUANCE" },
    });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("WITHDRAWAL_APPROVAL", now, token)).rejects.toMatchObject({
      status: 403,
    });
  });

  it("rejects a regular user regardless of permission", async () => {
    const user = await makeUser({ role: "USER" });
    const now = new Date();
    const token = await makeSessionToken(user.id, now);

    await expect(requirePermission("LEDGER_VIEW", now, token)).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe("requireMainAdmin", () => {
  it("allows the main admin", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requireMainAdmin(now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });

  it("rejects a sub-admin even with every permission granted", async () => {
    const subAdmin = await makeUser({ role: "ADMIN" });
    const now = new Date();
    const permissions = [
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
    ] as const;
    await prisma.adminPermissionGrant.createMany({
      data: permissions.map((permission) => ({ adminUserId: subAdmin.id, permission })),
    });
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requireMainAdmin(now, token)).rejects.toMatchObject({ status: 403 });
  });
});
