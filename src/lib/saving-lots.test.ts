import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { releaseDueSavingLots } from "./saving-lots";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];
const createdLotIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser() {
  const user = await registerAsRoot({
    email: `savinglot-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Saving Lot User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makeLot(userId: string, amount: string, unlocksAt: Date, overrides: { releasedAt?: Date } = {}) {
  const lot = await prisma.savingLot.create({
    data: {
      userId,
      amount,
      unlocksAt,
      releasedAt: overrides.releasedAt ?? null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  createdLotIds.push(lot.id);
  return lot;
}

/** Fund a user's SAVING wallet directly, mirroring how Direct Commission (Phase 6) will eventually credit it alongside creating the lot. */
async function fundSaving(userId: string, amount: string) {
  await prisma.walletAccount.update({
    where: { userId_type: { userId, type: "SAVING" } },
    data: { balance: { increment: amount } },
  });
}

afterAll(async () => {
  await prisma.savingLot.deleteMany({ where: { id: { in: createdLotIds } } });
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("releaseDueSavingLots", () => {
  it("releases a lot past its unlock date into Wallet C", async () => {
    const user = await makeUser();
    await fundSaving(user.id, "300");
    const lot = await makeLot(user.id, "300", new Date("2026-08-01T00:00:00.000Z"));

    const asOfDate = new Date("2026-08-17T00:00:00.000Z");
    await releaseDueSavingLots(asOfDate);

    const updatedLot = await prisma.savingLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(updatedLot.releasedAt?.toISOString()).toBe(asOfDate.toISOString());

    const walletSaving = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "SAVING" } } });
    expect(new Prisma.Decimal(walletSaving.balance).isZero()).toBe(true);

    const walletC = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "C" } } });
    expect(new Prisma.Decimal(walletC.balance).eq("300")).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({ where: { referenceType: "saving_lot", referenceId: lot.id } });
    expect(entries).toHaveLength(2);
    const debit = entries.find((e) => e.direction === "DEBIT")!;
    const credit = entries.find((e) => e.direction === "CREDIT")!;
    expect(debit.wallet).toBe("SAVING");
    expect(debit.userId).toBe(user.id);
    expect(credit.wallet).toBe("C");
    expect(credit.userId).toBe(user.id);
    expect(new Prisma.Decimal(debit.amount).eq("300")).toBe(true);
    expect(new Prisma.Decimal(credit.amount).eq("300")).toBe(true);
  });

  it("leaves a lot not yet due untouched", async () => {
    const user = await makeUser();
    await fundSaving(user.id, "150");
    const lot = await makeLot(user.id, "150", new Date("2026-09-01T00:00:00.000Z"));

    await releaseDueSavingLots(new Date("2026-08-17T00:00:00.000Z"));

    const unchangedLot = await prisma.savingLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(unchangedLot.releasedAt).toBeNull();

    const walletSaving = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "SAVING" } } });
    expect(new Prisma.Decimal(walletSaving.balance).eq("150")).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({ where: { referenceType: "saving_lot", referenceId: lot.id } });
    expect(entries).toHaveLength(0);
  });

  it("does not reprocess an already-released lot", async () => {
    const user = await makeUser();
    // Wallet already reflects a prior release: SAVING never funded, C already has it.
    await prisma.walletAccount.update({
      where: { userId_type: { userId: user.id, type: "C" } },
      data: { balance: { increment: "500" } },
    });
    const previouslyReleasedAt = new Date("2026-08-05T00:00:00.000Z");
    const lot = await makeLot(user.id, "500", new Date("2026-08-01T00:00:00.000Z"), { releasedAt: previouslyReleasedAt });

    await releaseDueSavingLots(new Date("2026-08-17T00:00:00.000Z"));

    const unchangedLot = await prisma.savingLot.findUniqueOrThrow({ where: { id: lot.id } });
    expect(unchangedLot.releasedAt?.toISOString()).toBe(previouslyReleasedAt.toISOString());

    const entries = await prisma.ledgerEntry.findMany({ where: { referenceType: "saving_lot", referenceId: lot.id } });
    expect(entries).toHaveLength(0);

    const walletC = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "C" } } });
    expect(new Prisma.Decimal(walletC.balance).eq("500")).toBe(true); // unchanged, not doubled
  });

  it("releases multiple due lots for the same user, each correctly", async () => {
    const user = await makeUser();
    await fundSaving(user.id, "600"); // 200 + 400 across two lots
    const lot1 = await makeLot(user.id, "200", new Date("2026-08-01T00:00:00.000Z"));
    const lot2 = await makeLot(user.id, "400", new Date("2026-08-10T00:00:00.000Z"));
    const futureLot = await makeLot(user.id, "999", new Date("2026-12-01T00:00:00.000Z"));

    const asOfDate = new Date("2026-08-17T00:00:00.000Z");
    await releaseDueSavingLots(asOfDate);

    const updatedLot1 = await prisma.savingLot.findUniqueOrThrow({ where: { id: lot1.id } });
    const updatedLot2 = await prisma.savingLot.findUniqueOrThrow({ where: { id: lot2.id } });
    const unchangedFutureLot = await prisma.savingLot.findUniqueOrThrow({ where: { id: futureLot.id } });
    expect(updatedLot1.releasedAt).not.toBeNull();
    expect(updatedLot2.releasedAt).not.toBeNull();
    expect(unchangedFutureLot.releasedAt).toBeNull();

    const walletSaving = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "SAVING" } } });
    expect(new Prisma.Decimal(walletSaving.balance).isZero()).toBe(true);

    const walletC = await prisma.walletAccount.findUniqueOrThrow({ where: { userId_type: { userId: user.id, type: "C" } } });
    expect(new Prisma.Decimal(walletC.balance).eq("600")).toBe(true);

    const entries1 = await prisma.ledgerEntry.findMany({ where: { referenceType: "saving_lot", referenceId: lot1.id } });
    const entries2 = await prisma.ledgerEntry.findMany({ where: { referenceType: "saving_lot", referenceId: lot2.id } });
    expect(entries1).toHaveLength(2);
    expect(entries2).toHaveLength(2);
  });
});
