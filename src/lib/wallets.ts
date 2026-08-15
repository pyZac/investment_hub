import type { Prisma } from "@prisma/client";

const USER_WALLET_TYPES = ["A", "B", "C", "SAVING"] as const;

export async function createWalletsForUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.walletAccount.createMany({
    data: USER_WALLET_TYPES.map((type) => ({ userId, type, balance: "0" })),
  });
}
