import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";

const createdEntryIds: string[] = [];

async function disableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_entries_no_delete`);
}

async function enableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_entries_no_delete`);
}

afterAll(async () => {
  // The append-only DELETE trigger has no exception for tests, by design —
  // it must be disabled to clean up test rows, then re-enabled immediately.
  await disableDeleteTrigger();
  await prisma.ledgerEntry.deleteMany({ where: { id: { in: createdEntryIds } } });
  await enableDeleteTrigger();
  await prisma.$disconnect();
});

async function createTestEntry(overrides: Partial<Parameters<typeof prisma.ledgerEntry.create>[0]["data"]> = {}) {
  const entry = await prisma.ledgerEntry.create({
    data: {
      wallet: "SYSTEM_EXTERNAL",
      direction: "DEBIT",
      amount: "100",
      entryType: "ADMIN_CREDIT",
      comment: "test entry",
      idempotencyKey: `test-${crypto.randomUUID()}`,
      ...overrides,
    },
  });
  createdEntryIds.push(entry.id);
  return entry;
}

describe("ledger_entries append-only enforcement", () => {
  it("rejects UPDATE", async () => {
    const entry = await createTestEntry();

    await expect(
      prisma.ledgerEntry.update({ where: { id: entry.id }, data: { comment: "mutated" } }),
    ).rejects.toThrow(/append-only/i);
  });

  it("rejects DELETE", async () => {
    const entry = await createTestEntry();

    await expect(prisma.ledgerEntry.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/i);
  });
});

describe("ledger_entries constraints", () => {
  it("rejects a negative amount", async () => {
    await expect(
      prisma.ledgerEntry.create({
        data: {
          wallet: "SYSTEM_EXTERNAL",
          direction: "DEBIT",
          amount: "-5",
          entryType: "ADMIN_CREDIT",
          comment: "should fail",
          idempotencyKey: `test-negative-${crypto.randomUUID()}`,
        },
      }),
    ).rejects.toThrow(/ledger_entries_amount_positive/);
  });

  it("rejects a duplicate (idempotency_key, user_id, wallet, direction)", async () => {
    const key = `test-dup-${crypto.randomUUID()}`;
    await createTestEntry({ idempotencyKey: key });

    await expect(createTestEntry({ idempotencyKey: key })).rejects.toMatchObject({ code: "P2002" });
  });

  it("allows the same idempotency key on rows that differ in wallet/direction/user (one transaction's two sides)", async () => {
    const key = `test-samekey-${crypto.randomUUID()}`;
    const debit = await createTestEntry({ idempotencyKey: key, wallet: "SYSTEM_EXTERNAL", direction: "DEBIT" });
    const credit = await createTestEntry({ idempotencyKey: key, wallet: "B", direction: "CREDIT", userId: null });

    expect(debit.idempotencyKey).toBe(credit.idempotencyKey);
    expect(debit.id).not.toBe(credit.id);
  });
});
