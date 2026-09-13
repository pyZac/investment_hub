import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";
import { assertFriday } from "./withdrawal-guard";
import { config } from "./config";
import { AccountSuspendedError } from "./transfers";

export class BelowMinimumWithdrawalError extends Error {
  constructor() {
    super(`Withdrawal requests require a minimum of $${config.MIN_WITHDRAWAL}.`);
    this.name = "BelowMinimumWithdrawalError";
  }
}

export class WithdrawalRequestNotPendingError extends Error {
  constructor() {
    super("This withdrawal request has already been decided.");
    this.name = "WithdrawalRequestNotPendingError";
  }
}

/**
 * Submits a Wallet B exit ("burn") request. Friday-only (Asia/Dubai) and
 * $50-minimum, both enforced here regardless of what the client sent. No
 * ledger entry is written at submission — the request only sits PENDING
 * until an admin decides it.
 */
export async function submitWithdrawalRequest(userId: string, amount: Prisma.Decimal.Value, forDate: Date) {
  assertFriday(forDate);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.suspendedAt !== null) {
    throw new AccountSuspendedError();
  }

  const requestedAmount = new Prisma.Decimal(amount);
  if (requestedAmount.lt(config.MIN_WITHDRAWAL)) {
    throw new BelowMinimumWithdrawalError();
  }

  return prisma.withdrawalRequest.create({
    data: {
      userId,
      amount: requestedAmount,
      status: "PENDING",
      requestedAt: forDate,
    },
  });
}

/**
 * A user's own B-exit requests, newest first. Ownership is enforced by
 * construction — userId is the only filter, no separate target-user param
 * exists to view someone else's requests (invariant #9).
 */
export async function listWithdrawalRequestsForUser(userId: string) {
  return prisma.withdrawalRequest.findMany({
    where: { userId },
    orderBy: { requestedAt: "desc" },
  });
}

/**
 * Every PENDING Wallet B exit request across all users, oldest first
 * (FIFO — first submitted, first reviewed), for the admin approval queue.
 * Includes the requester's name and their CURRENT Wallet B balance (a live
 * read, not the balance at request time) so the admin can see whether
 * there's still enough to actually approve. WITHDRAWAL_APPROVAL-gated
 * (main admin bypasses) — this is an admin-facing, all-users query by
 * design, not scoped by invariant #9's self-ownership rule.
 */
export async function listPendingWithdrawalRequests(actingAdminId: string) {
  await requireWithdrawalApproval(actingAdminId);

  const requests = await prisma.withdrawalRequest.findMany({
    where: { status: "PENDING" },
    orderBy: { requestedAt: "asc" },
    include: { user: { select: { id: true, name: true, email: true } } },
  });

  if (requests.length === 0) {
    return [];
  }

  const userIds = [...new Set(requests.map((r) => r.userId))];
  const walletBRows = await prisma.walletAccount.findMany({
    where: { userId: { in: userIds }, type: "B" },
  });
  const walletBByUser = new Map(walletBRows.map((w) => [w.userId, w.balance]));

  return requests.map((r) => ({
    id: r.id,
    userId: r.userId,
    userName: r.user.name,
    userEmail: r.user.email,
    amount: r.amount,
    requestedAt: r.requestedAt,
    walletBBalance: walletBByUser.get(r.userId) ?? new Prisma.Decimal(0),
  }));
}

/**
 * Past decisions (APPROVED/REJECTED), newest first — the admin panel's
 * history view. Includes who decided it and the reason/comment given.
 * WITHDRAWAL_APPROVAL-gated (main admin bypasses), same reasoning as
 * listPendingWithdrawalRequests.
 */
export async function listDecidedWithdrawalRequests(actingAdminId: string) {
  await requireWithdrawalApproval(actingAdminId);

  const requests = await prisma.withdrawalRequest.findMany({
    where: { status: { in: ["APPROVED", "REJECTED"] } },
    orderBy: { decidedAt: "desc" },
    include: {
      user: { select: { name: true, email: true } },
      decidedByAdmin: { select: { name: true, email: true } },
    },
  });

  return requests.map((r) => ({
    id: r.id,
    userName: r.user.name,
    userEmail: r.user.email,
    amount: r.amount,
    status: r.status,
    requestedAt: r.requestedAt,
    decidedAt: r.decidedAt,
    decidedByAdminName: r.decidedByAdmin?.name ?? null,
    adminComment: r.adminComment,
  }));
}

async function requireWithdrawalApproval(actingAdminId: string) {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }

  if (!admin.isMainAdmin) {
    const grant = await prisma.adminPermissionGrant.findUnique({
      where: {
        adminUserId_permission: {
          adminUserId: actingAdminId,
          permission: "WITHDRAWAL_APPROVAL",
        },
      },
    });
    if (!grant) {
      throw new Error("Forbidden: missing WITHDRAWAL_APPROVAL permission.");
    }
  }
}

/**
 * Approves a PENDING Wallet B exit request: posts DEBIT user's B / CREDIT
 * SYSTEM_EXTERNAL (the amount is burned — leaves the simulation) and marks
 * the request APPROVED. May happen on any day, not just Friday — the
 * Friday-only rule applies to the user's submission, not the admin's
 * decision.
 *
 * `adminComment` is optional here (unlike rejectWithdrawalRequest, where a
 * comment is always required) — the admin panel (SCRUM-105) treats a reason
 * as mandatory at the UI/action layer for both approve and reject, but this
 * library function stays permissive so existing callers/tests that never
 * passed one keep working unchanged, with adminComment simply staying null.
 */
export async function approveWithdrawalRequest(
  actingAdminId: string,
  requestId: string,
  decidedAt: Date,
  adminComment?: string,
) {
  await requireWithdrawalApproval(actingAdminId);

  const request = await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (request.status !== "PENDING") {
    throw new WithdrawalRequestNotPendingError();
  }

  return prisma.$transaction(async (tx) => {
    const idempotencyKey = `withdrawal_request_approval:${request.id}`;
    const comment = `Wallet B exit approved (request ${request.id}).`;

    const result = await postTransaction(
      {
        entries: [
          {
            userId: request.userId,
            wallet: "B",
            direction: "DEBIT",
            amount: request.amount,
            entryType: "WITHDRAWAL_OUT",
            referenceType: "withdrawal_request",
            referenceId: request.id,
            comment,
          },
          {
            userId: null,
            wallet: "SYSTEM_EXTERNAL",
            direction: "CREDIT",
            amount: request.amount,
            entryType: "WITHDRAWAL_OUT",
            referenceType: "withdrawal_request",
            referenceId: request.id,
            comment,
          },
        ],
        idempotencyKey,
      },
      tx,
    );

    const updated = await tx.withdrawalRequest.update({
      where: { id: request.id },
      data: {
        status: "APPROVED",
        decidedAt,
        decidedByAdminId: actingAdminId,
        ...(adminComment ? { adminComment } : {}),
      },
    });

    return { request: updated, alreadyProcessed: result.alreadyProcessed };
  });
}

/**
 * Rejects a PENDING Wallet B exit request. Requires a non-empty comment.
 * No ledger entry is written and Wallet B is left untouched.
 */
export async function rejectWithdrawalRequest(
  actingAdminId: string,
  requestId: string,
  comment: string,
  decidedAt: Date,
) {
  await requireWithdrawalApproval(actingAdminId);

  if (!comment.trim()) {
    throw new Error("A comment is required to reject a withdrawal request.");
  }

  const request = await prisma.withdrawalRequest.findUniqueOrThrow({ where: { id: requestId } });
  if (request.status !== "PENDING") {
    throw new WithdrawalRequestNotPendingError();
  }

  return prisma.withdrawalRequest.update({
    where: { id: request.id },
    data: {
      status: "REJECTED",
      decidedAt,
      decidedByAdminId: actingAdminId,
      adminComment: comment,
    },
  });
}
