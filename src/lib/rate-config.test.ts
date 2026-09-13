import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { hashToken } from "./token-hash";
import { requirePermission } from "./route-guard";
import { dailyRate } from "./interest-rate";
import { setInterestRate, getCurrentRate, listRateHistory, BackdatedRateError } from "./rate-config";

const createdUserIds: string[] = [];
const createdConfigIds: string[] = [];

async function makeAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `rate-admin-${crypto.randomUUID()}@test.local`,
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

/**
 * setInterestRate closes the real singleton active row and creates a new
 * one — restoring original state after a test means reopening the
 * original row and deleting whatever new row(s) the test created, mirroring
 * interest-rate.test.ts's existing "manipulate the real row, restore in
 * finally" convention for this same table.
 */
async function withRestoredActiveRate(fn: () => Promise<void>) {
  const originalActive = await prisma.interestRateConfig.findFirstOrThrow({ where: { effectiveTo: null } });
  try {
    await fn();
  } finally {
    const strayRows = await prisma.interestRateConfig.findMany({
      where: { id: { not: originalActive.id }, effectiveFrom: { gte: originalActive.effectiveFrom } },
    });
    for (const row of strayRows) {
      await prisma.interestRateConfig.delete({ where: { id: row.id } });
    }
    await prisma.interestRateConfig.update({
      where: { id: originalActive.id },
      data: { effectiveTo: null },
    });
  }
}

afterAll(async () => {
  await prisma.interestRateConfig.deleteMany({ where: { id: { in: createdConfigIds } } });
  await prisma.adminAction.deleteMany({ where: { adminId: { in: createdUserIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("route-level enforcement", () => {
  it("a sub-admin without RATE_CONFIG is rejected at the route level", async () => {
    const subAdmin = await makeAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("RATE_CONFIG", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("a sub-admin with RATE_CONFIG is allowed at the route level", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({ data: { adminUserId: subAdmin.id, permission: "RATE_CONFIG" } });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("RATE_CONFIG", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("RATE_CONFIG", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });
});

describe("setInterestRate", () => {
  it("rejects a backdated effective date, writing nothing", async () => {
    await withRestoredActiveRate(async () => {
      const mainAdmin = await getMainAdmin();
      const now = new Date("2026-09-11T10:00:00.000Z");
      const past = new Date("2026-09-01T00:00:00.000Z");

      await expect(
        setInterestRate(mainAdmin.id, { monthlyRate: "9", effectiveFrom: past, reason: "Test." }, now),
      ).rejects.toThrow(BackdatedRateError);

      const stillOneActive = await prisma.interestRateConfig.count({ where: { effectiveTo: null } });
      expect(stillOneActive).toBe(1);
    });
  });

  it("rejects an effective date equal to now (not strictly in the future)", async () => {
    await withRestoredActiveRate(async () => {
      const mainAdmin = await getMainAdmin();
      const now = new Date("2026-09-11T10:00:00.000Z");

      await expect(
        setInterestRate(mainAdmin.id, { monthlyRate: "9", effectiveFrom: now, reason: "Test." }, now),
      ).rejects.toThrow(BackdatedRateError);
    });
  });

  it("a valid rate change creates a new version without modifying the previous one", async () => {
    await withRestoredActiveRate(async () => {
      const mainAdmin = await getMainAdmin();
      const originalActive = await prisma.interestRateConfig.findFirstOrThrow({ where: { effectiveTo: null } });
      const originalSnapshot = { ...originalActive };

      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-01T00:00:00.000Z");

      const created = await setInterestRate(
        mainAdmin.id,
        { monthlyRate: "9.5", effectiveFrom: future, reason: "Scheduled Q4 rate change." },
        now,
      );

      expect(created.id).not.toBe(originalActive.id);
      expect(new Prisma.Decimal(created.monthlyRate).eq("9.5")).toBe(true);
      expect(created.effectiveFrom.getTime()).toBe(future.getTime());
      expect(created.effectiveTo).toBeNull();
      expect(created.setByAdminId).toBe(mainAdmin.id);

      const oldRowAfter = await prisma.interestRateConfig.findUniqueOrThrow({ where: { id: originalActive.id } });
      expect(new Prisma.Decimal(oldRowAfter.monthlyRate).toString()).toBe(
        new Prisma.Decimal(originalSnapshot.monthlyRate).toString(),
      );
      expect(oldRowAfter.effectiveFrom.getTime()).toBe(originalSnapshot.effectiveFrom.getTime());
      expect(oldRowAfter.createdAt.getTime()).toBe(originalSnapshot.createdAt.getTime());
      // Only effectiveTo changed on the old row — it now closes exactly at
      // the new row's effectiveFrom.
      expect(oldRowAfter.effectiveTo?.getTime()).toBe(future.getTime());

      const action = await prisma.adminAction.findFirst({
        where: { adminId: mainAdmin.id, actionType: "RATE_CONFIG_SET", reason: "Scheduled Q4 rate change." },
      });
      expect(action).not.toBeNull();
      expect(new Prisma.Decimal(action!.amount!).eq("9.5")).toBe(true);

      // dailyRate() (the Phase 4 read path) must still resolve correctly for
      // "now" (the old rate is still active) with no drift introduced.
      const rateNow = await dailyRate(now);
      expect(rateNow.toString()).not.toBe("0");
    });
  });

  it("rejects a sub-admin without RATE_CONFIG", async () => {
    await withRestoredActiveRate(async () => {
      const subAdmin = await makeAdmin();
      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-01T00:00:00.000Z");

      await expect(
        setInterestRate(subAdmin.id, { monthlyRate: "9", effectiveFrom: future, reason: "Test." }, now),
      ).rejects.toThrow(/forbidden|RATE_CONFIG/i);
    });
  });

  it("allows a sub-admin with RATE_CONFIG", async () => {
    await withRestoredActiveRate(async () => {
      const subAdmin = await makeAdmin();
      await prisma.adminPermissionGrant.create({ data: { adminUserId: subAdmin.id, permission: "RATE_CONFIG" } });
      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-01T00:00:00.000Z");

      const created = await setInterestRate(
        subAdmin.id,
        { monthlyRate: "6", effectiveFrom: future, reason: "Sub-admin change." },
        now,
      );
      expect(created.setByAdminId).toBe(subAdmin.id);
    });
  });

  it("rejects a missing/empty reason", async () => {
    await withRestoredActiveRate(async () => {
      const mainAdmin = await getMainAdmin();
      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-01T00:00:00.000Z");

      await expect(
        setInterestRate(mainAdmin.id, { monthlyRate: "9", effectiveFrom: future, reason: "" }, now),
      ).rejects.toThrow();

      const stillOneActive = await prisma.interestRateConfig.count({ where: { effectiveTo: null } });
      expect(stillOneActive).toBe(1);
    });
  });
});

describe("getCurrentRate", () => {
  it("returns the single open-ended row with the setting admin's name", async () => {
    const mainAdmin = await getMainAdmin();
    const current = await getCurrentRate(mainAdmin.id, new Date());

    expect(current).not.toBeNull();
    expect(current?.effectiveTo).toBeNull();
  });

  it("rejects a caller without RATE_CONFIG", async () => {
    const subAdmin = await makeAdmin();
    await expect(getCurrentRate(subAdmin.id, new Date())).rejects.toThrow(/forbidden/i);
  });

  it("still returns the OLD rate as current when a future-dated change has been scheduled — regression check for a real bug caught in manual verification", async () => {
    await withRestoredActiveRate(async () => {
      const mainAdmin = await getMainAdmin();
      const originalActive = await prisma.interestRateConfig.findFirstOrThrow({ where: { effectiveTo: null } });
      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-11T00:00:00.000Z");

      await setInterestRate(mainAdmin.id, { monthlyRate: "12", effectiveFrom: future, reason: "Scheduled." }, now);

      // The naive "effectiveTo IS NULL" query would incorrectly return the
      // new future-dated row here (its effectiveTo IS null, even though its
      // effectiveFrom hasn't arrived yet) — getCurrentRate must instead
      // still resolve to the row genuinely active "now", matching
      // dailyRate()'s own bounds exactly.
      const current = await getCurrentRate(mainAdmin.id, now);
      expect(current?.id).toBe(originalActive.id);

      const rateAtFutureDate = await getCurrentRate(mainAdmin.id, future);
      expect(rateAtFutureDate?.monthlyRate.toString()).toBe("12");
    });
  });
});

describe("listRateHistory", () => {
  it("returns all versions newest-effectiveFrom-first, including a newly created one", async () => {
    await withRestoredActiveRate(async () => {
      const mainAdmin = await getMainAdmin();
      const now = new Date("2026-09-11T10:00:00.000Z");
      const future = new Date("2026-10-15T00:00:00.000Z");

      const created = await setInterestRate(
        mainAdmin.id,
        { monthlyRate: "7.25", effectiveFrom: future, reason: "History ordering test." },
        now,
      );

      const history = await listRateHistory(mainAdmin.id);
      expect(history[0].id).toBe(created.id);
      expect(history[0].setByAdmin?.name).toBe(mainAdmin.name);

      for (let i = 0; i < history.length - 1; i++) {
        expect(history[i].effectiveFrom.getTime()).toBeGreaterThanOrEqual(history[i + 1].effectiveFrom.getTime());
      }
    });
  });

  it("rejects a caller without RATE_CONFIG", async () => {
    const subAdmin = await makeAdmin();
    await expect(listRateHistory(subAdmin.id)).rejects.toThrow(/forbidden/i);
  });
});
