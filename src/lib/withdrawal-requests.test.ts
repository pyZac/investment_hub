import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { postTransaction } from "./ledger-transaction";
import {
  submitWithdrawalRequest,
  approveWithdrawalRequest,
  rejectWithdrawalRequest,
  BelowMinimumWithdrawalError,
  WithdrawalRequestNotPendingError,
} from "./withdrawal-requests";
import { NotFridayError } from "./withdrawal-guard";
import { AccountSuspendedError } from "./transfers";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];
const createdRequestIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

// 2026-08-21 is a Friday. Noon UTC is also Friday in Asia/Dubai (UTC+4).
const FRIDAY = new Date("2026-08-21T12:00:00.000Z");
// 2026-08-20 is a Thursday.
const THURSDAY = new Date("2026-08-20T12:00:00.000Z");
// Admin decisions may happen any day — use a Wednesday deliberately.
const WEDNESDAY = new Date("2026-08-19T12:00:00.000Z");

async function makeUser() {
  const user = await registerAsRoot({
    email: `wreq-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Withdrawal Req User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `wreq-admin-${crypto.randomUUID()}@test.local`,
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

async function fundWalletB(userId: string, amount: string) {
  const idempotencyKey = `test-fund:B:${userId}:${crypto.randomUUID()}`;
  await postTransaction({
    entries: [
      { userId, wallet: "B", direction: "CREDIT", amount, entryType: "ADMIN_CREDIT", comment: "Test funding." },
      { userId: null, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT", amount, entryType: "ADMIN_CREDIT", comment: "Test funding." },
    ],
    idempotencyKey,
  });
}

afterAll(async () => {
  await prisma.withdrawalRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("submitWithdrawalRequest", () => {
  it("rejects a $49 request at submission and writes no row", async () => {
    const user = await makeUser();
    await fundWalletB(user.id, "1000");

    await expect(submitWithdrawalRequest(user.id, "49", FRIDAY)).rejects.toThrow(BelowMinimumWithdrawalError);

    const requests = await prisma.withdrawalRequest.findMany({ where: { userId: user.id } });
    expect(requests).toHaveLength(0);
  });

  it("accepts exactly $50 (inclusive minimum) and sits PENDING", async () => {
    const user = await makeUser();
    await fundWalletB(user.id, "1000");

    const request = await submitWithdrawalRequest(user.id, "50", FRIDAY);
    createdRequestIds.push(request.id);

    expect(request.status).toBe("PENDING");
    expect(new Prisma.Decimal(request.amount).eq("50")).toBe(true);

    // No money moves at submission.
    const walletB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "B" } } });
    expect(new Prisma.Decimal(walletB.balance).eq("1000")).toBe(true);
  });

  it("rejects submission on a non-Friday", async () => {
    const user = await makeUser();
    await fundWalletB(user.id, "1000");

    await expect(submitWithdrawalRequest(user.id, "200", THURSDAY)).rejects.toThrow(NotFridayError);

    const requests = await prisma.withdrawalRequest.findMany({ where: { userId: user.id } });
    expect(requests).toHaveLength(0);
  });

  it("blocks a suspended user", async () => {
    const user = await makeUser();
    await fundWalletB(user.id, "1000");
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: FRIDAY } });

    await expect(submitWithdrawalRequest(user.id, "200", FRIDAY)).rejects.toThrow(AccountSuspendedError);
  });
});

describe("approveWithdrawalRequest", () => {
  it("moves the money and updates status when approved by the main admin", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    await fundWalletB(user.id, "1000");
    const request = await submitWithdrawalRequest(user.id, "200", FRIDAY);
    createdRequestIds.push(request.id);

    const { request: updated } = await approveWithdrawalRequest(mainAdmin.id, request.id, WEDNESDAY);

    expect(updated.status).toBe("APPROVED");
    expect(updated.decidedByAdminId).toBe(mainAdmin.id);
    expect(updated.decidedAt?.toISOString()).toBe(WEDNESDAY.toISOString());

    const walletB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "B" } } });
    expect(new Prisma.Decimal(walletB.balance).eq("800")).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "withdrawal_request", referenceId: request.id },
    });
    expect(entries).toHaveLength(2);
    const debit = entries.find((e) => e.direction === "DEBIT")!;
    const credit = entries.find((e) => e.direction === "CREDIT")!;
    expect(debit.userId).toBe(user.id);
    expect(debit.wallet).toBe("B");
    expect(credit.userId).toBeNull();
    expect(credit.wallet).toBe("SYSTEM_EXTERNAL");
  });

  it("moves the money when approved by a sub-admin with WITHDRAWAL_APPROVAL", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({ data: { adminUserId: subAdmin.id, permission: "WITHDRAWAL_APPROVAL" } });
    const user = await makeUser();
    await fundWalletB(user.id, "500");
    const request = await submitWithdrawalRequest(user.id, "100", FRIDAY);
    createdRequestIds.push(request.id);

    const { request: updated } = await approveWithdrawalRequest(subAdmin.id, request.id, WEDNESDAY);
    expect(updated.status).toBe("APPROVED");

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "withdrawal_request", referenceId: request.id },
    });
    expect(entries).toHaveLength(2);
  });

  it("rejects approval by an admin without the WITHDRAWAL_APPROVAL grant, no state change", async () => {
    const subAdmin = await makeAdmin();
    const user = await makeUser();
    await fundWalletB(user.id, "500");
    const request = await submitWithdrawalRequest(user.id, "100", FRIDAY);
    createdRequestIds.push(request.id);

    await expect(approveWithdrawalRequest(subAdmin.id, request.id, WEDNESDAY)).rejects.toThrow(
      /forbidden|WITHDRAWAL_APPROVAL/i,
    );

    const unchanged = await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(unchanged.status).toBe("PENDING");
    const walletB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "B" } } });
    expect(new Prisma.Decimal(walletB.balance).eq("500")).toBe(true);
  });

  it("can be decided on a non-Friday (admin side has no Friday restriction)", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    await fundWalletB(user.id, "500");
    const request = await submitWithdrawalRequest(user.id, "100", FRIDAY);
    createdRequestIds.push(request.id);

    // WEDNESDAY is not a Friday; approval must still succeed.
    const { request: updated } = await approveWithdrawalRequest(mainAdmin.id, request.id, WEDNESDAY);
    expect(updated.status).toBe("APPROVED");

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "withdrawal_request", referenceId: request.id },
    });
  });

  it("rejects re-approving an already-decided request", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    await fundWalletB(user.id, "500");
    const request = await submitWithdrawalRequest(user.id, "100", FRIDAY);
    createdRequestIds.push(request.id);

    await approveWithdrawalRequest(mainAdmin.id, request.id, WEDNESDAY);
    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "withdrawal_request", referenceId: request.id },
    });

    await expect(approveWithdrawalRequest(mainAdmin.id, request.id, WEDNESDAY)).rejects.toThrow(
      WithdrawalRequestNotPendingError,
    );

    // Still only 2 entries — no double-burn.
    const entriesAfter = await prisma.ledgerEntry.findMany({
      where: { referenceType: "withdrawal_request", referenceId: request.id },
    });
    expect(entriesAfter).toHaveLength(2);
  });
});

describe("rejectWithdrawalRequest", () => {
  it("leaves Wallet B untouched, records the reason, writes no ledger entry", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    await fundWalletB(user.id, "500");
    const request = await submitWithdrawalRequest(user.id, "100", FRIDAY);
    createdRequestIds.push(request.id);

    const updated = await rejectWithdrawalRequest(mainAdmin.id, request.id, "Suspicious activity on account.", WEDNESDAY);

    expect(updated.status).toBe("REJECTED");
    expect(updated.adminComment).toBe("Suspicious activity on account.");
    expect(updated.decidedByAdminId).toBe(mainAdmin.id);

    const walletB = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "B" } } });
    expect(new Prisma.Decimal(walletB.balance).eq("500")).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "withdrawal_request", referenceId: request.id },
    });
    expect(entries).toHaveLength(0);
  });

  it("rejects a rejection with an empty comment", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    await fundWalletB(user.id, "500");
    const request = await submitWithdrawalRequest(user.id, "100", FRIDAY);
    createdRequestIds.push(request.id);

    await expect(rejectWithdrawalRequest(mainAdmin.id, request.id, "  ", WEDNESDAY)).rejects.toThrow(/comment/i);

    const unchanged = await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(unchanged.status).toBe("PENDING");
  });

  it("rejects rejection by an admin without the WITHDRAWAL_APPROVAL grant", async () => {
    const subAdmin = await makeAdmin();
    const user = await makeUser();
    await fundWalletB(user.id, "500");
    const request = await submitWithdrawalRequest(user.id, "100", FRIDAY);
    createdRequestIds.push(request.id);

    await expect(rejectWithdrawalRequest(subAdmin.id, request.id, "No grant.", WEDNESDAY)).rejects.toThrow(
      /forbidden|WITHDRAWAL_APPROVAL/i,
    );
  });
});
