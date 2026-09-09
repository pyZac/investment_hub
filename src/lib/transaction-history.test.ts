import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { postTransaction } from "./ledger-transaction";
import { listLedgerEntriesForUser, ENTRY_TYPE_LABELS, PAGE_SIZE } from "./transaction-history";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

afterAll(async () => {
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function makeUser(label: string) {
  const user = await registerAsRoot({
    email: `txhistory-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Tx History Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

/**
 * Writes a real credit + its paired SYSTEM_EXTERNAL debit directly via
 * `ledgerEntry.create` (not `postTransaction`) so `createdAt` can be
 * explicitly controlled for date-range filter tests — `ledger_entries` is
 * append-only (an UPDATE trigger blocks changing it after the fact, see
 * ledger.test.ts) and `postTransaction` always stamps `now()`, so backdating
 * only works by setting it at insert time.
 */
async function creditEntry(userId: string, wallet: "A" | "B" | "C", entryType: Parameters<typeof postTransaction>[0]["entries"][0]["entryType"], amount: string, createdAt: Date) {
  const key = `txhistory:${userId}:${crypto.randomUUID()}`;
  await prisma.ledgerEntry.create({
    data: {
      userId,
      wallet,
      direction: "CREDIT",
      amount,
      entryType,
      comment: `test ${entryType}`,
      idempotencyKey: key,
      createdAt,
    },
  });
  await prisma.ledgerEntry.create({
    data: {
      userId: null,
      wallet: "SYSTEM_EXTERNAL",
      direction: "DEBIT",
      amount,
      entryType,
      comment: `test ${entryType}`,
      idempotencyKey: key,
      createdAt,
    },
  });
}

describe("listLedgerEntriesForUser", () => {
  it("returns only the calling user's own entries, newest first, excluding the SYSTEM_EXTERNAL side", async () => {
    const user = await makeUser("scoped");
    const other = await makeUser("scoped-other");
    const now = new Date();

    await creditEntry(user.id, "A", "DAILY_INTEREST", "10", now);
    await creditEntry(user.id, "C", "DIRECT_COMMISSION", "20", new Date(now.getTime() + 1000));
    await creditEntry(other.id, "A", "DAILY_INTEREST", "999", now);

    const page = await listLedgerEntriesForUser(user.id, {}, 1);
    expect(page.total).toBe(2);
    expect(page.entries).toHaveLength(2);
    expect(page.entries.every((e) => e.wallet !== ("SYSTEM_EXTERNAL" as never))).toBe(true);
    // newest first
    expect(page.entries[0].entryType).toBe("DIRECT_COMMISSION");
    expect(page.entries[1].entryType).toBe("DAILY_INTEREST");
  });

  it("filters by wallet", async () => {
    const user = await makeUser("wallet-filter");
    const now = new Date();
    await creditEntry(user.id, "A", "DAILY_INTEREST", "5", now);
    await creditEntry(user.id, "C", "BINARY_COMMISSION", "15", now);

    const page = await listLedgerEntriesForUser(user.id, { wallet: "C" }, 1);
    expect(page.total).toBe(1);
    expect(page.entries[0].entryType).toBe("BINARY_COMMISSION");
  });

  it("filters by entryType", async () => {
    const user = await makeUser("type-filter");
    const now = new Date();
    await creditEntry(user.id, "A", "DAILY_INTEREST", "5", now);
    await creditEntry(user.id, "C", "RANK_REWARD", "500", now);

    const page = await listLedgerEntriesForUser(user.id, { entryType: "RANK_REWARD" }, 1);
    expect(page.total).toBe(1);
    expect(page.entries[0].entryType).toBe("RANK_REWARD");
  });

  it("filters by date range (dateFrom/dateTo inclusive)", async () => {
    const user = await makeUser("date-filter");
    const early = new Date("2026-01-01T10:00:00.000Z");
    const middle = new Date("2026-06-01T10:00:00.000Z");
    const late = new Date("2026-12-01T10:00:00.000Z");
    await creditEntry(user.id, "A", "DAILY_INTEREST", "1", early);
    await creditEntry(user.id, "A", "DAILY_INTEREST", "2", middle);
    await creditEntry(user.id, "A", "DAILY_INTEREST", "3", late);

    const page = await listLedgerEntriesForUser(
      user.id,
      { dateFrom: new Date("2026-03-01T00:00:00.000Z"), dateTo: new Date("2026-09-01T00:00:00.000Z") },
      1,
    );
    expect(page.total).toBe(1);
    expect(new Prisma.Decimal(page.entries[0].amount).equals("2")).toBe(true);
  });

  it("paginates: page 2 returns the next slice, respecting PAGE_SIZE", async () => {
    const user = await makeUser("pagination");
    const now = new Date();
    for (let i = 0; i < PAGE_SIZE + 5; i++) {
      await creditEntry(user.id, "A", "DAILY_INTEREST", "1", new Date(now.getTime() + i * 1000));
    }

    const page1 = await listLedgerEntriesForUser(user.id, {}, 1);
    const page2 = await listLedgerEntriesForUser(user.id, {}, 2);
    expect(page1.total).toBe(PAGE_SIZE + 5);
    expect(page1.entries).toHaveLength(PAGE_SIZE);
    expect(page2.entries).toHaveLength(5);
    // no overlap between pages
    const page1Ids = new Set(page1.entries.map((e) => e.id));
    expect(page2.entries.every((e) => !page1Ids.has(e.id))).toBe(true);
  });

  it("returns an empty page for a user with no ledger history", async () => {
    const user = await makeUser("empty");
    const page = await listLedgerEntriesForUser(user.id, {}, 1);
    expect(page.total).toBe(0);
    expect(page.entries).toHaveLength(0);
  });
});

describe("ENTRY_TYPE_LABELS", () => {
  it("has a readable label for every LedgerEntryType enum value", () => {
    const expectedKeys = [
      "ADMIN_CREDIT",
      "PACKAGE_PURCHASE",
      "DAILY_INTEREST",
      "DIRECT_COMMISSION",
      "DIRECT_SAVING",
      "BINARY_COMMISSION",
      "RANK_REWARD",
      "WITHDRAWAL_OUT",
      "WITHDRAWAL_IN",
      "CAPITAL_RELEASE",
      "SAVING_UNLOCK",
      "ADMIN_ADJUSTMENT",
    ];
    for (const key of expectedKeys) {
      expect(ENTRY_TYPE_LABELS).toHaveProperty(key);
      expect(typeof ENTRY_TYPE_LABELS[key as keyof typeof ENTRY_TYPE_LABELS]).toBe("string");
    }
  });
});
