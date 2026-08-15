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

/**
 * The only function that creates new money in the simulation. CREDIT the
 * target user's Wallet B, DEBIT SYSTEM_EXTERNAL — money entering from outside
 * the simulation (Decision 1). Requires the main admin or a CREDIT_ISSUANCE
 * grant. The reason is stored on both the ledger entry's comment and
 * admin_actions.
 */
export async function adminCreditWalletB(actingAdminId: string, input: AdminCreditWalletBInput) {
  const data = adminCreditWalletBInputSchema.parse(input);

  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }

  if (!admin.isMainAdmin) {
    const grant = await prisma.adminPermissionGrant.findUnique({
      where: {
        adminUserId_permission: {
          adminUserId: actingAdminId,
          permission: "CREDIT_ISSUANCE",
        },
      },
    });
    if (!grant) {
      throw new Error("Forbidden: missing CREDIT_ISSUANCE permission.");
    }
  }

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
