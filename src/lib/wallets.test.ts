import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

afterAll(async () => {
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("wallet auto-creation", () => {
  it("creates exactly the 4 wallets (A, B, C, SAVING) at balance 0 on registration", async () => {
    const user = await registerAsRoot({
      email: `wallet-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Wallet User",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);

    const wallets = await prisma.walletAccount.findMany({
      where: { userId: user.id },
      orderBy: { type: "asc" },
    });

    expect(wallets.map((w) => w.type)).toEqual(["A", "B", "C", "SAVING"]);
    for (const wallet of wallets) {
      expect(wallet.balance.isZero()).toBe(true);
    }
  });

  it("rejects a duplicate (userId, type) wallet", async () => {
    const user = await registerAsRoot({
      email: `wallet-dup-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Wallet Dup User",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);

    await expect(
      prisma.walletAccount.create({ data: { userId: user.id, type: "A", balance: "0" } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects SYSTEM_EXTERNAL as a wallet type", async () => {
    const user = await registerAsRoot({
      email: `wallet-sysext-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Wallet SysExt User",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);

    await expect(
      prisma.walletAccount.create({ data: { userId: user.id, type: "SYSTEM_EXTERNAL", balance: "0" } }),
    ).rejects.toThrow(/wallets_type_not_system_external/);
  });
});
