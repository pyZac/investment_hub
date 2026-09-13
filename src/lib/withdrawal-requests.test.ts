import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { postTransaction } from "./ledger-transaction";
import {
  submitWithdrawalRequest,
  approveWithdrawalRequest,
  rejectWithdrawalRequest,
  listPendingWithdrawalRequests,
  listDecidedWithdrawalRequests,
  BelowMinimumWithdrawalError,
  WithdrawalRequestNotPendingError,
} from "./withdrawal-requests";
import { NotFridayError } from "./withdrawal-guard";
import { AccountSuspendedError } from "./transfers";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";
import { hashToken } from "./token-hash";
import { requirePermission } from "./route-guard";

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
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
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

describe("route-level enforcement (SCRUM-105)", () => {
  it("a sub-admin without WITHDRAWAL_APPROVAL is rejected at the route level", async () => {
    const subAdmin = await makeAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("WITHDRAWAL_APPROVAL", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("a sub-admin with WITHDRAWAL_APPROVAL is allowed at the route level", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({ data: { adminUserId: subAdmin.id, permission: "WITHDRAWAL_APPROVAL" } });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("WITHDRAWAL_APPROVAL", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("WITHDRAWAL_APPROVAL", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });
});

describe("approveWithdrawalRequest with a comment (SCRUM-105)", () => {
  it("persists the comment to adminComment when provided", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    await fundWalletB(user.id, "300");
    const request = await submitWithdrawalRequest(user.id, "150", FRIDAY);
    createdRequestIds.push(request.id);

    const { request: updated } = await approveWithdrawalRequest(
      mainAdmin.id,
      request.id,
      WEDNESDAY,
      "Verified identity, approved.",
    );

    expect(updated.status).toBe("APPROVED");
    expect(updated.adminComment).toBe("Verified identity, approved.");
  });

  it("still works with no comment (backward compatible, adminComment stays null)", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    await fundWalletB(user.id, "300");
    const request = await submitWithdrawalRequest(user.id, "150", FRIDAY);
    createdRequestIds.push(request.id);

    const { request: updated } = await approveWithdrawalRequest(mainAdmin.id, request.id, WEDNESDAY);

    expect(updated.status).toBe("APPROVED");
    expect(updated.adminComment).toBeNull();
  });
});

describe("listPendingWithdrawalRequests", () => {
  it("returns only PENDING requests, oldest first, with user name and current Wallet B balance", async () => {
    const mainAdmin = await getMainAdmin();
    const userA = await makeUser();
    const userB = await makeUser();
    await fundWalletB(userA.id, "500");
    await fundWalletB(userB.id, "700");

    const earlier = new Date(FRIDAY.getTime() - 60 * 60 * 1000);
    const requestA = await submitWithdrawalRequest(userA.id, "100", earlier);
    createdRequestIds.push(requestA.id);
    const requestB = await submitWithdrawalRequest(userB.id, "200", FRIDAY);
    createdRequestIds.push(requestB.id);

    // A third, already-decided request must not appear in the pending queue.
    const requestC = await submitWithdrawalRequest(userA.id, "50", FRIDAY);
    createdRequestIds.push(requestC.id);
    await rejectWithdrawalRequest(mainAdmin.id, requestC.id, "Not eligible.", WEDNESDAY);

    const pending = await listPendingWithdrawalRequests(mainAdmin.id);
    const ids = pending.map((r) => r.id);

    expect(ids).toContain(requestA.id);
    expect(ids).toContain(requestB.id);
    expect(ids).not.toContain(requestC.id);

    const indexA = ids.indexOf(requestA.id);
    const indexB = ids.indexOf(requestB.id);
    expect(indexA).toBeLessThan(indexB); // oldest first (FIFO)

    const rowA = pending.find((r) => r.id === requestA.id)!;
    expect(rowA.userName).toBe(userA.name);
    expect(new Prisma.Decimal(rowA.walletBBalance).eq("500")).toBe(true);
  });

  it("rejects a caller without WITHDRAWAL_APPROVAL", async () => {
    const subAdmin = await makeAdmin();
    await expect(listPendingWithdrawalRequests(subAdmin.id)).rejects.toThrow(/forbidden/i);
  });
});

describe("listDecidedWithdrawalRequests", () => {
  it("returns only APPROVED/REJECTED, newest first, with decider and comment", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();
    await fundWalletB(user.id, "500");

    const requestApproved = await submitWithdrawalRequest(user.id, "100", FRIDAY);
    createdRequestIds.push(requestApproved.id);
    await approveWithdrawalRequest(mainAdmin.id, requestApproved.id, WEDNESDAY, "Looks good.");

    const laterDecision = new Date(WEDNESDAY.getTime() + 60 * 60 * 1000);
    const requestRejected = await submitWithdrawalRequest(user.id, "60", FRIDAY);
    createdRequestIds.push(requestRejected.id);
    await rejectWithdrawalRequest(mainAdmin.id, requestRejected.id, "Insufficient documentation.", laterDecision);

    const pendingUntouched = await submitWithdrawalRequest(user.id, "70", FRIDAY);
    createdRequestIds.push(pendingUntouched.id);

    const decided = await listDecidedWithdrawalRequests(mainAdmin.id);
    const ids = decided.map((r) => r.id);

    expect(ids).toContain(requestApproved.id);
    expect(ids).toContain(requestRejected.id);
    expect(ids).not.toContain(pendingUntouched.id);

    const indexRejected = ids.indexOf(requestRejected.id);
    const indexApproved = ids.indexOf(requestApproved.id);
    expect(indexRejected).toBeLessThan(indexApproved); // newest decidedAt first

    const rejectedRow = decided.find((r) => r.id === requestRejected.id)!;
    expect(rejectedRow.status).toBe("REJECTED");
    expect(rejectedRow.decidedByAdminName).toBe(mainAdmin.name);
    expect(rejectedRow.adminComment).toBe("Insufficient documentation.");
  });

  it("rejects a caller without WITHDRAWAL_APPROVAL", async () => {
    const subAdmin = await makeAdmin();
    await expect(listDecidedWithdrawalRequests(subAdmin.id)).rejects.toThrow(/forbidden/i);
  });
});
