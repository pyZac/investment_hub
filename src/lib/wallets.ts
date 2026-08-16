import type { Prisma, Wallet } from "@prisma/client";
import { prisma } from "./prisma";

const USER_WALLET_TYPES = ["A", "B", "C", "SAVING"] as const;

export async function createWalletsForUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.walletAccount.createMany({
    data: USER_WALLET_TYPES.map((type) => ({ userId, type, balance: "0" })),
  });
}

export async function getWalletBalance(userId: string, type: Wallet) {
  const wallet = await prisma.walletAccount.findUniqueOrThrow({
    where: { userId_type: { userId, type } },
  });
  return wallet.balance;
}
