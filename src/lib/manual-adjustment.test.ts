import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  reverseLedgerTransaction,
  findLedgerTransactionByEntryId,
  listRecentManualAdjustments,
  LedgerTransactionNotFoundError,
  AlreadyReversedError,
} from "./manual-adjustment";
import { adminCreditWalletB } from "./admin-credit";
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
    email: `manual-adj-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Manual Adjustment User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeSubAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `manual-adj-subadmin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Sub-Admin",
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

/** Creates a real balanced 2-entry transaction (userId CREDIT / SYSTEM_EXTERNAL
 * DEBIT) via the real adminCreditWalletB path, so tests reverse a genuine
 * ledger transaction rather than hand-inserting rows. */
async function makeOriginalTransaction(userId: string) {
  const idempotencyKey = `test-original:${userId}:${crypto.randomUUID()}`;
  await adminCreditWalletB((await getMainAdmin()).id, {
    userId,
    amount: "1000",
    reason: "Test funding for manual-adjustment reversal tests.",
    idempotencyKey,
  });
  return idempotencyKey;
}

afterAll(async () => {
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.adminAction.deleteMany({ where: { adminId: { in: createdUserIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("route-level enforcement", () => {
  it("a sub-admin without MANUAL_ADJUSTMENT is rejected at the route level", async () => {
    const subAdmin = await makeSubAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("MANUAL_ADJUSTMENT", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("a sub-admin with MANUAL_ADJUSTMENT is allowed at the route level", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "MANUAL_ADJUSTMENT" },
    });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("MANUAL_ADJUSTMENT", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("MANUAL_ADJUSTMENT", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });
});

describe("reverseLedgerTransaction", () => {
  it("rejects a missing/empty reason, writing nothing", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const idempotencyKey = await makeOriginalTransaction(user.id);

    await expect(
      reverseLedgerTransaction(mainAdmin.id, { idempotencyKey, reason: "" }),
    ).rejects.toThrow();

    const allEntries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(allEntries).toHaveLength(2); // only the original pair, no reversal posted

    const reversalEntries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: `manual_adjustment:${idempotencyKey}` },
    });
    expect(reversalEntries).toHaveLength(0);
  });

  it("posting a reversal creates a new ledger entry without modifying the original", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const idempotencyKey = await makeOriginalTransaction(user.id);

    const originalBefore = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey },
      orderBy: { direction: "asc" },
    });
    const originalSnapshot = originalBefore.map((e) => ({ ...e }));

    await reverseLedgerTransaction(mainAdmin.id, { idempotencyKey, reason: "Correcting a test error." });

    // The ORIGINAL rows are byte-identical — never updated, never deleted.
    const originalAfter = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey },
      orderBy: { direction: "asc" },
    });
    expect(originalAfter).toHaveLength(2);
    for (let i = 0; i < originalAfter.length; i++) {
      expect(originalAfter[i].id).toBe(originalSnapshot[i].id);
      expect(originalAfter[i].amount.toString()).toBe(originalSnapshot[i].amount.toString());
      expect(originalAfter[i].direction).toBe(originalSnapshot[i].direction);
      expect(originalAfter[i].createdAt.getTime()).toBe(originalSnapshot[i].createdAt.getTime());
    }

    // A genuinely NEW, separate set of rows was posted under a different key.
    const reversalKey = `manual_adjustment:${idempotencyKey}`;
    const reversalEntries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey: reversalKey } });
    expect(reversalEntries).toHaveLength(2);
    for (const reversal of reversalEntries) {
      expect(originalSnapshot.some((o) => o.id === reversal.id)).toBe(false);
      const original = originalSnapshot.find(
        (o) => o.userId === reversal.userId && o.wallet === reversal.wallet,
      )!;
      // Equal amount, opposite direction — reverses the exact economic effect.
      expect(reversal.amount.toString()).toBe(original.amount.toString());
      expect(reversal.direction).not.toBe(original.direction);
      expect(reversal.entryType).toBe("ADMIN_ADJUSTMENT");
      expect(reversal.referenceType).toBe("manual_adjustment");
      expect(reversal.referenceId).toBe(idempotencyKey);
      expect(reversal.comment).toBe("Correcting a test error.");
    }

    const action = await prisma.adminAction.findFirst({
      where: { adminId: mainAdmin.id, actionType: "MANUAL_ADJUSTMENT_POSTED", reason: "Correcting a test error." },
    });
    expect(action).not.toBeNull();

    // The user's Wallet B balance is back to 0 — the reversal is balanced
    // and actually undoes the original credit's real economic effect.
    const walletB = await prisma.walletAccount.findUniqueOrThrow({
      where: { userId_type: { userId: user.id, type: "B" } },
    });
    expect(new Prisma.Decimal(walletB.balance).isZero()).toBe(true);
  });

  it("reverses EVERY sibling row sharing the idempotencyKey, not just one side (stays balanced)", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const idempotencyKey = await makeOriginalTransaction(user.id);

    const result = await reverseLedgerTransaction(mainAdmin.id, { idempotencyKey, reason: "Balance check." });
    if (result.alreadyProcessed) throw new Error("unexpected alreadyProcessed");

    // Exactly 2 reversal rows for a 2-row original — both sides reversed.
    expect(result.entries).toHaveLength(2);

    const totalDebits = result.entries
      .filter((e) => e.direction === "DEBIT")
      .reduce((sum, e) => sum.add(e.amount.toString()), new Prisma.Decimal(0));
    const totalCredits = result.entries
      .filter((e) => e.direction === "CREDIT")
      .reduce((sum, e) => sum.add(e.amount.toString()), new Prisma.Decimal(0));
    expect(totalDebits.eq(totalCredits)).toBe(true);
  });

  it("rejects reversing an unknown idempotencyKey", async () => {
    const mainAdmin = await getMainAdmin();

    await expect(
      reverseLedgerTransaction(mainAdmin.id, { idempotencyKey: `nonexistent:${crypto.randomUUID()}`, reason: "Test." }),
    ).rejects.toThrow(LedgerTransactionNotFoundError);
  });

  it("rejects reversing an already-reversed transaction", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const idempotencyKey = await makeOriginalTransaction(user.id);

    await reverseLedgerTransaction(mainAdmin.id, { idempotencyKey, reason: "First reversal." });

    await expect(
      reverseLedgerTransaction(mainAdmin.id, { idempotencyKey, reason: "Second attempt." }),
    ).rejects.toThrow(AlreadyReversedError);

    // Still exactly one reversal transaction (2 rows), not doubled.
    const reversalEntries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: `manual_adjustment:${idempotencyKey}` },
    });
    expect(reversalEntries).toHaveLength(2);
  });

  it("rejects a sub-admin without MANUAL_ADJUSTMENT", async () => {
    const subAdmin = await makeSubAdmin();
    const user = await makeUser();
    const idempotencyKey = await makeOriginalTransaction(user.id);

    await expect(
      reverseLedgerTransaction(subAdmin.id, { idempotencyKey, reason: "Test." }),
    ).rejects.toThrow(/forbidden|MANUAL_ADJUSTMENT/i);
  });

  it("allows a sub-admin with MANUAL_ADJUSTMENT", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "MANUAL_ADJUSTMENT" },
    });
    const user = await makeUser();
    const idempotencyKey = await makeOriginalTransaction(user.id);

    const result = await reverseLedgerTransaction(subAdmin.id, { idempotencyKey, reason: "Sub-admin reversal." });
    expect(result.alreadyProcessed).toBe(false);

    const action = await prisma.adminAction.findFirst({
      where: { adminId: subAdmin.id, actionType: "MANUAL_ADJUSTMENT_POSTED" },
    });
    expect(action).not.toBeNull();
  });
});

describe("findLedgerTransactionByEntryId", () => {
  it("returns every sibling row sharing the selected entry's idempotencyKey", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const idempotencyKey = await makeOriginalTransaction(user.id);

    const oneEntry = await prisma.ledgerEntry.findFirstOrThrow({ where: { idempotencyKey, userId: user.id } });

    const siblings = await findLedgerTransactionByEntryId(mainAdmin.id, oneEntry.id);
    expect(siblings).toHaveLength(2);
    expect(siblings.some((s) => s.userId === user.id && s.wallet === "B")).toBe(true);
    expect(siblings.some((s) => s.userId === null && s.wallet === "SYSTEM_EXTERNAL")).toBe(true);

    const userSide = siblings.find((s) => s.userId === user.id)!;
    expect(userSide.userName).toBe(user.name);
  });

  it("rejects a caller without MANUAL_ADJUSTMENT", async () => {
    const subAdmin = await makeSubAdmin();
    const user = await makeUser();
    const idempotencyKey = await makeOriginalTransaction(user.id);
    const oneEntry = await prisma.ledgerEntry.findFirstOrThrow({ where: { idempotencyKey, userId: user.id } });

    await expect(findLedgerTransactionByEntryId(subAdmin.id, oneEntry.id)).rejects.toThrow(/forbidden/i);
  });
});

describe("listRecentManualAdjustments", () => {
  it("returns the most recent adjustments, newest first", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    const idempotencyKey = await makeOriginalTransaction(user.id);

    await reverseLedgerTransaction(mainAdmin.id, { idempotencyKey, reason: "Recency check." });

    const recent = await listRecentManualAdjustments(mainAdmin.id);
    expect(recent.length).toBeGreaterThan(0);
    expect(recent[0].reason).toBe("Recency check.");
    expect(recent[0].adminName).toBe(mainAdmin.name);
  });

  it("rejects a caller without MANUAL_ADJUSTMENT", async () => {
    const subAdmin = await makeSubAdmin();
    await expect(listRecentManualAdjustments(subAdmin.id)).rejects.toThrow(/forbidden/i);
  });
});
