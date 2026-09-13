import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { hashToken } from "./token-hash";
import { requirePermission } from "./route-guard";
import {
  setCommissionConfig,
  getCurrentCommissionConfig,
  listCommissionConfigHistory,
  BackdatedCommissionConfigError,
  SplitMismatchError,
} from "./commission-config";

const createdUserIds: string[] = [];

async function makeAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `commission-admin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Admin",
      role: "ADMIN",
    },
  });
  createdUserIds.push(admin.id);
  return admin;
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

const validInput = {
  directRate: "8",
  directCommissionSplit: "62.5",
  directSavingSplit: "37.5",
  binaryRate: "8",
  binaryCarryForwardExpiryMonths: 6,
};

/**
 * setCommissionConfig closes the real singleton active row and creates a
 * new one — restoring original state after a test means reopening the
 * original row and deleting whatever new row(s) the test created. Mirrors
 * rate-config.test.ts's withRestoredActiveRate convention for the sibling
 * table.
 */
async function withRestoredActiveConfig(fn: () => Promise<void>) {
  const originalActive = await prisma.commissionConfig.findFirstOrThrow({ where: { effectiveTo: null } });
  try {
    await fn();
  } finally {
    const strayRows = await prisma.commissionConfig.findMany({
      where: { id: { not: originalActive.id }, effectiveFrom: { gte: originalActive.effectiveFrom } },
    });
    for (const row of strayRows) {
      await prisma.commissionConfig.delete({ where: { id: row.id } });
    }
    await prisma.commissionConfig.update({
      where: { id: originalActive.id },
      data: { effectiveTo: null },
    });
  }
}

afterAll(async () => {
  await prisma.adminAction.deleteMany({ where: { adminId: { in: createdUserIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("route-level enforcement", () => {
  it("a sub-admin without COMMISSION_CONFIG is rejected at the route level", async () => {
    const subAdmin = await makeAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("COMMISSION_CONFIG", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("a sub-admin with COMMISSION_CONFIG is allowed at the route level", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "COMMISSION_CONFIG" },
    });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("COMMISSION_CONFIG", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("COMMISSION_CONFIG", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });
});

describe("setCommissionConfig", () => {
  it("rejects a split that does not sum to 100%, writing nothing", async () => {
    await withRestoredActiveConfig(async () => {
      const mainAdmin = await getMainAdmin();
      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-01T00:00:00.000Z");

      await expect(
        setCommissionConfig(
          mainAdmin.id,
          { ...validInput, directCommissionSplit: "60", directSavingSplit: "35", effectiveFrom: future, reason: "Test." },
          now,
        ),
      ).rejects.toThrow(SplitMismatchError);

      const stillOneActive = await prisma.commissionConfig.count({ where: { effectiveTo: null } });
      expect(stillOneActive).toBe(1);
    });
  });

  it("rejects a backdated effective date, writing nothing", async () => {
    await withRestoredActiveConfig(async () => {
      const mainAdmin = await getMainAdmin();
      const now = new Date("2026-09-11T10:00:00.000Z");
      const past = new Date("2026-09-01T00:00:00.000Z");

      await expect(
        setCommissionConfig(mainAdmin.id, { ...validInput, effectiveFrom: past, reason: "Test." }, now),
      ).rejects.toThrow(BackdatedCommissionConfigError);

      const stillOneActive = await prisma.commissionConfig.count({ where: { effectiveTo: null } });
      expect(stillOneActive).toBe(1);
    });
  });

  it("rejects an effective date equal to now (not strictly in the future)", async () => {
    await withRestoredActiveConfig(async () => {
      const mainAdmin = await getMainAdmin();
      const now = new Date("2026-09-11T10:00:00.000Z");

      await expect(
        setCommissionConfig(mainAdmin.id, { ...validInput, effectiveFrom: now, reason: "Test." }, now),
      ).rejects.toThrow(BackdatedCommissionConfigError);
    });
  });

  it("a valid commission change creates a new version without modifying the previous one", async () => {
    await withRestoredActiveConfig(async () => {
      const mainAdmin = await getMainAdmin();
      const originalActive = await prisma.commissionConfig.findFirstOrThrow({ where: { effectiveTo: null } });
      const originalSnapshot = { ...originalActive };

      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-01T00:00:00.000Z");

      const created = await setCommissionConfig(
        mainAdmin.id,
        {
          directRate: "10",
          directCommissionSplit: "70",
          directSavingSplit: "30",
          binaryRate: "9",
          binaryCarryForwardExpiryMonths: 4,
          effectiveFrom: future,
          reason: "Scheduled Q4 commission rule change.",
        },
        now,
      );

      expect(created.id).not.toBe(originalActive.id);
      expect(new Prisma.Decimal(created.directRate).eq("10")).toBe(true);
      expect(new Prisma.Decimal(created.directCommissionSplit).eq("70")).toBe(true);
      expect(new Prisma.Decimal(created.directSavingSplit).eq("30")).toBe(true);
      expect(new Prisma.Decimal(created.binaryRate).eq("9")).toBe(true);
      expect(created.binaryCarryForwardExpiryMonths).toBe(4);
      expect(created.effectiveFrom.getTime()).toBe(future.getTime());
      expect(created.effectiveTo).toBeNull();
      expect(created.setByAdminId).toBe(mainAdmin.id);

      const oldRowAfter = await prisma.commissionConfig.findUniqueOrThrow({ where: { id: originalActive.id } });
      expect(new Prisma.Decimal(oldRowAfter.directRate).toString()).toBe(
        new Prisma.Decimal(originalSnapshot.directRate).toString(),
      );
      expect(new Prisma.Decimal(oldRowAfter.directCommissionSplit).toString()).toBe(
        new Prisma.Decimal(originalSnapshot.directCommissionSplit).toString(),
      );
      expect(new Prisma.Decimal(oldRowAfter.directSavingSplit).toString()).toBe(
        new Prisma.Decimal(originalSnapshot.directSavingSplit).toString(),
      );
      expect(oldRowAfter.binaryCarryForwardExpiryMonths).toBe(originalSnapshot.binaryCarryForwardExpiryMonths);
      expect(oldRowAfter.effectiveFrom.getTime()).toBe(originalSnapshot.effectiveFrom.getTime());
      expect(oldRowAfter.createdAt.getTime()).toBe(originalSnapshot.createdAt.getTime());
      // Only effectiveTo changed on the old row — it now closes exactly at
      // the new row's effectiveFrom.
      expect(oldRowAfter.effectiveTo?.getTime()).toBe(future.getTime());

      const action = await prisma.adminAction.findFirst({
        where: { adminId: mainAdmin.id, actionType: "COMMISSION_CONFIG_SET", reason: "Scheduled Q4 commission rule change." },
      });
      expect(action).not.toBeNull();
    });
  });

  it("rejects a sub-admin without COMMISSION_CONFIG", async () => {
    await withRestoredActiveConfig(async () => {
      const subAdmin = await makeAdmin();
      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-01T00:00:00.000Z");

      await expect(
        setCommissionConfig(subAdmin.id, { ...validInput, effectiveFrom: future, reason: "Test." }, now),
      ).rejects.toThrow(/forbidden|COMMISSION_CONFIG/i);
    });
  });

  it("allows a sub-admin with COMMISSION_CONFIG", async () => {
    await withRestoredActiveConfig(async () => {
      const subAdmin = await makeAdmin();
      await prisma.adminPermissionGrant.create({
        data: { adminUserId: subAdmin.id, permission: "COMMISSION_CONFIG" },
      });
      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-01T00:00:00.000Z");

      const created = await setCommissionConfig(
        subAdmin.id,
        { ...validInput, effectiveFrom: future, reason: "Sub-admin change." },
        now,
      );
      expect(created.setByAdminId).toBe(subAdmin.id);
    });
  });

  it("rejects a missing/empty reason", async () => {
    await withRestoredActiveConfig(async () => {
      const mainAdmin = await getMainAdmin();
      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-01T00:00:00.000Z");

      await expect(
        setCommissionConfig(mainAdmin.id, { ...validInput, effectiveFrom: future, reason: "" }, now),
      ).rejects.toThrow();

      const stillOneActive = await prisma.commissionConfig.count({ where: { effectiveTo: null } });
      expect(stillOneActive).toBe(1);
    });
  });
});

describe("getCurrentCommissionConfig", () => {
  it("returns the single open-ended row with the setting admin's name", async () => {
    const mainAdmin = await getMainAdmin();
    const current = await getCurrentCommissionConfig(mainAdmin.id, new Date());

    expect(current).not.toBeNull();
    expect(current?.effectiveTo).toBeNull();
  });

  it("rejects a caller without COMMISSION_CONFIG", async () => {
    const subAdmin = await makeAdmin();
    await expect(getCurrentCommissionConfig(subAdmin.id, new Date())).rejects.toThrow(/forbidden/i);
  });

  it("still returns the OLD config as current when a future-dated change has been scheduled — regression check, same bug class as SCRUM-108's getCurrentRate", async () => {
    await withRestoredActiveConfig(async () => {
      const mainAdmin = await getMainAdmin();
      const originalActive = await prisma.commissionConfig.findFirstOrThrow({ where: { effectiveTo: null } });
      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-11T00:00:00.000Z");

      await setCommissionConfig(
        mainAdmin.id,
        { ...validInput, binaryRate: "12", effectiveFrom: future, reason: "Scheduled." },
        now,
      );

      // The naive "effectiveTo IS NULL" query would incorrectly return the
      // new future-dated row here — getCurrentCommissionConfig must instead
      // still resolve to the row genuinely active "now".
      const current = await getCurrentCommissionConfig(mainAdmin.id, now);
      expect(current?.id).toBe(originalActive.id);

      const configAtFutureDate = await getCurrentCommissionConfig(mainAdmin.id, future);
      expect(configAtFutureDate?.binaryRate.toString()).toBe("12");
    });
  });
});

describe("listCommissionConfigHistory", () => {
  it("returns all versions newest-effectiveFrom-first, including a newly created one", async () => {
    await withRestoredActiveConfig(async () => {
      const mainAdmin = await getMainAdmin();
      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-15T00:00:00.000Z");

      const created = await setCommissionConfig(
        mainAdmin.id,
        { ...validInput, effectiveFrom: future, reason: "History ordering test." },
        now,
      );

      const history = await listCommissionConfigHistory(mainAdmin.id);
      expect(history[0].id).toBe(created.id);
      expect(history[0].setByAdmin?.name).toBe(mainAdmin.name);

      for (let i = 0; i < history.length - 1; i++) {
        expect(history[i].effectiveFrom.getTime()).toBeGreaterThanOrEqual(history[i + 1].effectiveFrom.getTime());
      }
    });
  });

  it("rejects a caller without COMMISSION_CONFIG", async () => {
    const subAdmin = await makeAdmin();
    await expect(listCommissionConfigHistory(subAdmin.id)).rejects.toThrow(/forbidden/i);
  });
});
