import { z } from "zod";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";

const adminCreditWalletBInputSchema = z.object({
  userId: z.string(),
  amount: z.string().or(z.number()),
  reason: z.string().min(1, "A reason is required to credit Wallet B."),
  idempotencyKey: z.string().min(1),
});

export type AdminCreditWalletBInput = z.infer<typeof adminCreditWalletBInputSchema>;

async function assertHasCreditIssuancePermission(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }
  if (admin.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "CREDIT_ISSUANCE" } },
  });
  if (!grant) {
    throw new Error("Forbidden: missing CREDIT_ISSUANCE permission.");
  }
}

/**
 * The only function that creates new money in the simulation. CREDIT the
 * target user's Wallet B, DEBIT SYSTEM_EXTERNAL — money entering from outside
 * the simulation (Decision 1). Requires the main admin or a CREDIT_ISSUANCE
 * grant. The reason is stored on both the ledger entry's comment and
 * admin_actions.
 */
export async function adminCreditWalletB(actingAdminId: string, input: AdminCreditWalletBInput) {
  const data = adminCreditWalletBInputSchema.parse(input);

  await assertHasCreditIssuancePermission(actingAdminId);

  const target = await prisma.user.findUnique({ where: { id: data.userId } });
  if (!target) {
    throw new Error("Invalid target: user not found.");
  }
  if (target.suspendedAt) {
    throw new Error("Invalid target: account is suspended.");
  }

  return prisma.$transaction(async (tx) => {
    const result = await postTransaction(
      {
        entries: [
          {
            userId: data.userId,
            wallet: "B",
            direction: "CREDIT",
            amount: data.amount,
            entryType: "ADMIN_CREDIT",
            referenceType: "admin_credit",
            comment: data.reason,
          },
          {
            userId: null,
            wallet: "SYSTEM_EXTERNAL",
            direction: "DEBIT",
            amount: data.amount,
            entryType: "ADMIN_CREDIT",
            referenceType: "admin_credit",
            comment: data.reason,
          },
        ],
        idempotencyKey: data.idempotencyKey,
      },
      tx,
    );

    if (result.alreadyProcessed) {
      return result;
    }

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "CREDIT_ISSUANCE",
        targetUserId: data.userId,
        amount: data.amount,
        reason: data.reason,
      },
    });

    return result;
  });
}

const DEFAULT_RECENT_CREDITS_LIMIT = 20;

/**
 * The last N credit issuances (default 20), newest first, for the admin
 * panel's recent-activity log. Reads admin_actions directly (not
 * ledger_entries) since actionType/targetUserId/reason/amount/createdAt are
 * all already there in one row per issuance — no need to reconstruct from
 * the paired ledger entries. CREDIT_ISSUANCE-gated (main admin bypasses),
 * same as adminCreditWalletB itself.
 */
export async function listRecentCreditIssuances(actingAdminId: string, limit: number = DEFAULT_RECENT_CREDITS_LIMIT) {
  await assertHasCreditIssuancePermission(actingAdminId);

  const actions = await prisma.adminAction.findMany({
    where: { actionType: "CREDIT_ISSUANCE" },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      admin: { select: { name: true, email: true } },
      targetUser: { select: { name: true, email: true } },
    },
  });

  return actions.map((a) => ({
    id: a.id,
    targetUserName: a.targetUser?.name ?? null,
    targetUserEmail: a.targetUser?.email ?? null,
    adminName: a.admin.name,
    amount: a.amount,
    reason: a.reason,
    createdAt: a.createdAt,
  }));
}
