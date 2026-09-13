import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { adminCreditWalletB, listRecentCreditIssuances } from "./admin-credit";
import { registerAsRoot } from "./users";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";
import { hashToken } from "./token-hash";
import { requirePermission } from "./route-guard";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser() {
  const user = await registerAsRoot({
    email: `admin-credit-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Admin Credit User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `admin-credit-admin-${crypto.randomUUID()}@test.local`,
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

afterAll(async () => {
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.adminAction.deleteMany({
    where: { OR: [{ targetUserId: { in: createdUserIds } }, { adminId: { in: createdUserIds } }] },
  });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("adminCreditWalletB", () => {
  it("credits Wallet B and posts the SYSTEM_EXTERNAL side correctly, and logs to admin_actions", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const idempotencyKey = `test-credit:${user.id}:${crypto.randomUUID()}`;

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "1000",
      reason: "Manual top-up for testing.",
      idempotencyKey,
    });

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).eq("1000")).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(entries).toHaveLength(2);

    const credit = entries.find((e) => e.direction === "CREDIT")!;
    const debit = entries.find((e) => e.direction === "DEBIT")!;
    expect(credit.userId).toBe(user.id);
    expect(credit.wallet).toBe("B");
    expect(debit.userId).toBeNull();
    expect(debit.wallet).toBe("SYSTEM_EXTERNAL");

    const action = await prisma.adminAction.findFirst({
      where: { targetUserId: user.id, actionType: "CREDIT_ISSUANCE" },
    });
    expect(action).not.toBeNull();
    expect(action?.adminId).toBe(mainAdmin.id);
    expect(action?.reason).toBe("Manual top-up for testing.");
    expect(new Prisma.Decimal(action!.amount!).eq("1000")).toBe(true);
  });

  it("rejects a missing/empty reason", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();

    await expect(
      adminCreditWalletB(mainAdmin.id, {
        userId: user.id,
        amount: "500",
        reason: "",
        idempotencyKey: `test-noreason:${user.id}:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow();

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).isZero()).toBe(true);
  });

  it("rejects a non-admin acting user", async () => {
    const nonAdmin = await makeUser();
    const target = await makeUser();

    await expect(
      adminCreditWalletB(nonAdmin.id, {
        userId: target.id,
        amount: "500",
        reason: "Should not be allowed.",
        idempotencyKey: `test-nonadmin:${target.id}:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("rejects a sub-admin without CREDIT_ISSUANCE", async () => {
    const subAdmin = await makeAdmin();
    const target = await makeUser();

    await expect(
      adminCreditWalletB(subAdmin.id, {
        userId: target.id,
        amount: "500",
        reason: "Should not be allowed.",
        idempotencyKey: `test-nogrant:${target.id}:${crypto.randomUUID()}`,
      }),
    ).rejects.toThrow(/forbidden|CREDIT_ISSUANCE/i);
  });

  it("allows a sub-admin with CREDIT_ISSUANCE", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "CREDIT_ISSUANCE" },
    });
    const target = await makeUser();
    const idempotencyKey = `test-grant:${target.id}:${crypto.randomUUID()}`;

    await adminCreditWalletB(subAdmin.id, {
      userId: target.id,
      amount: "300",
      reason: "Sub-admin issuance.",
      idempotencyKey,
    });

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(entries).toHaveLength(2);
  });

  it("is idempotent: replaying the same key does not double-credit", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const idempotencyKey = `test-credit-replay:${user.id}:${crypto.randomUUID()}`;

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "750",
      reason: "First call.",
      idempotencyKey,
    });
    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "750",
      reason: "Replayed call.",
      idempotencyKey,
    });

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(entries).toHaveLength(2);

    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).eq("750")).toBe(true);
  });
});

describe("route-level enforcement (SCRUM-106)", () => {
  it("a sub-admin without CREDIT_ISSUANCE is rejected at the route level", async () => {
    const subAdmin = await makeAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("CREDIT_ISSUANCE", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("a sub-admin with CREDIT_ISSUANCE is allowed at the route level", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({ data: { adminUserId: subAdmin.id, permission: "CREDIT_ISSUANCE" } });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("CREDIT_ISSUANCE", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("CREDIT_ISSUANCE", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });
});

describe("listRecentCreditIssuances", () => {
  it("returns newest first, respecting the limit, with correct target user and admin names", async () => {
    const mainAdmin = await getMainAdmin();
    const marker = crypto.randomUUID();
    const user = await makeUser();

    // Create 22 issuances (more than the default limit of 20) with a
    // strictly increasing timestamp order guaranteed by sequential awaits.
    for (let i = 0; i < 22; i++) {
      await adminCreditWalletB(mainAdmin.id, {
        userId: user.id,
        amount: "10",
        reason: `Batch ${marker} #${i}`,
        idempotencyKey: `test-recent:${marker}:${i}`,
      });
    }

    const recent = await listRecentCreditIssuances(mainAdmin.id);
    expect(recent).toHaveLength(20);

    const ourRows = recent.filter((r) => r.reason?.includes(marker));
    // Only the 20 most recent of our 22 should appear (the oldest 2 pushed
    // out — cannot assert an exact count here since other tests in this
    // file also write CREDIT_ISSUANCE rows to the same shared dev DB and
    // may interleave, but every row that IS present must decode correctly).
    expect(ourRows.length).toBeGreaterThan(0);
    expect(ourRows.length).toBeLessThanOrEqual(20);
    for (const row of ourRows) {
      expect(row.targetUserName).toBe(user.name);
      expect(row.adminName).toBe(mainAdmin.name);
      expect(new Prisma.Decimal(row.amount!).eq("10")).toBe(true);
    }

    // Newest-first ordering: index 0 must not be older than index 1, etc.
    for (let i = 0; i < recent.length - 1; i++) {
      expect(recent[i].createdAt.getTime()).toBeGreaterThanOrEqual(recent[i + 1].createdAt.getTime());
    }
  });

  it("rejects a caller without CREDIT_ISSUANCE", async () => {
    const subAdmin = await makeAdmin();
    await expect(listRecentCreditIssuances(subAdmin.id)).rejects.toThrow(/forbidden/i);
  });

  it("allows a sub-admin with CREDIT_ISSUANCE", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({ data: { adminUserId: subAdmin.id, permission: "CREDIT_ISSUANCE" } });

    const result = await listRecentCreditIssuances(subAdmin.id);
    expect(Array.isArray(result)).toBe(true);
  });
});
