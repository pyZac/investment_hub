import { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";
import { getDailyInterestHistoryA, getTodayInterestCreditA, getWalletOverview } from "./wallets";

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
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function makeUser(prefix: string) {
  const user = await registerAsRoot({
    email: `${prefix}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Wallet Overview User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

/**
 * Writes a ledger_entries row directly with an explicit createdAt, bypassing
 * postTransaction. postTransaction itself isn't under test here — only the
 * date-range aggregate query is — and createdAt (@default(now())) can't be
 * fabricated through the normal write path. The no-update/no-delete trigger
 * only blocks UPDATE/DELETE (invariant #2), not INSERT, so this is a plain
 * insert with a chosen idempotencyKey.
 */
async function seedInterestCredit(userId: string, amount: string, createdAt: Date) {
  await prisma.ledgerEntry.create({
    data: {
      userId,
      wallet: "A",
      direction: "CREDIT",
      amount: new Prisma.Decimal(amount),
      entryType: "DAILY_INTEREST",
      referenceType: "investment",
      referenceId: crypto.randomUUID(),
      comment: "Test daily interest credit.",
      idempotencyKey: `test:${crypto.randomUUID()}`,
      createdAt,
    },
  });
}

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

describe("getWalletOverview", () => {
  it("returns all 4 user-facing wallet balances in one call", async () => {
    const user = await makeUser("overview");

    const overview = await getWalletOverview(user.id);

    expect(new Set(Object.keys(overview))).toEqual(new Set(["A", "B", "C", "SAVING"]));
    expect(overview.A.isZero()).toBe(true);
    expect(overview.B.isZero()).toBe(true);
    expect(overview.C.isZero()).toBe(true);
    expect(overview.SAVING.isZero()).toBe(true);
  });

  it("reflects real balances, not just zeros", async () => {
    const user = await makeUser("overview-nonzero");
    await prisma.walletAccount.update({
      where: { userId_type: { userId: user.id, type: "B" } },
      data: { balance: "500.12345678" },
    });

    const overview = await getWalletOverview(user.id);

    expect(overview.B.toString()).toBe("500.12345678");
    expect(overview.A.isZero()).toBe(true);
  });
});

describe("getTodayInterestCreditA", () => {
  // A fixed instant safely mid-day in Asia/Dubai (UTC+4), so date-boundary
  // math has no ambiguity: 2026-06-10T08:00:00Z = 2026-06-10T12:00:00+04:00.
  const NOON_DUBAI = new Date("2026-06-10T08:00:00.000Z");
  const START_OF_DAY_UTC = new Date("2026-06-10T04:00:00.000Z"); // 00:00 Dubai — Dubai is 4h ahead
  const YESTERDAY_LATE = new Date("2026-06-09T19:59:59.000Z"); // 23:59:59 Dubai the day before
  const TOMORROW_EARLY = new Date("2026-06-11T04:00:00.000Z"); // 00:00 Dubai the next day

  it("sums today's DAILY_INTEREST Wallet A credits only", async () => {
    const user = await makeUser("interest-today");
    await seedInterestCredit(user.id, "12.50000000", START_OF_DAY_UTC);
    await seedInterestCredit(user.id, "3.25000000", NOON_DUBAI);

    const total = await getTodayInterestCreditA(user.id, NOON_DUBAI);

    expect(total.toString()).toBe("15.75");
  });

  it("excludes credits from the prior business day", async () => {
    const user = await makeUser("interest-yesterday");
    await seedInterestCredit(user.id, "999.00000000", YESTERDAY_LATE);

    const total = await getTodayInterestCreditA(user.id, NOON_DUBAI);

    expect(total.isZero()).toBe(true);
  });

  it("excludes credits from the next business day", async () => {
    const user = await makeUser("interest-tomorrow");
    await seedInterestCredit(user.id, "999.00000000", TOMORROW_EARLY);

    const total = await getTodayInterestCreditA(user.id, NOON_DUBAI);

    expect(total.isZero()).toBe(true);
  });

  it("excludes other entry types and other wallets", async () => {
    const user = await makeUser("interest-otherentries");
    await prisma.ledgerEntry.create({
      data: {
        userId: user.id,
        wallet: "A",
        direction: "CREDIT",
        amount: new Prisma.Decimal("40"),
        entryType: "ADMIN_CREDIT",
        comment: "Not daily interest.",
        idempotencyKey: `test:${crypto.randomUUID()}`,
        createdAt: NOON_DUBAI,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        userId: user.id,
        wallet: "C",
        direction: "CREDIT",
        amount: new Prisma.Decimal("40"),
        entryType: "DAILY_INTEREST",
        comment: "Wrong wallet.",
        idempotencyKey: `test:${crypto.randomUUID()}`,
        createdAt: NOON_DUBAI,
      },
    });

    const total = await getTodayInterestCreditA(user.id, NOON_DUBAI);

    expect(total.isZero()).toBe(true);
  });

  it("returns zero for a user with no interest credited today", async () => {
    const user = await makeUser("interest-none");

    const total = await getTodayInterestCreditA(user.id, NOON_DUBAI);

    expect(total.isZero()).toBe(true);
  });
});

describe("getDailyInterestHistoryA", () => {
  // 2026-06-08 = a Monday in Asia/Dubai; 2026-06-10 = the Wednesday two days
  // later. Using noon-Dubai instants throughout keeps every timestamp safely
  // inside its intended Dubai calendar day.
  const DAY1_NOON = new Date("2026-06-08T08:00:00.000Z");
  const DAY2_NOON = new Date("2026-06-09T08:00:00.000Z");
  const DAY3_NOON = new Date("2026-06-10T08:00:00.000Z");
  const BEFORE_RANGE_NOON = new Date("2026-06-01T08:00:00.000Z");
  const AFTER_RANGE_NOON = new Date("2026-06-20T08:00:00.000Z");

  it("buckets multiple credits on the same day and separates different days", async () => {
    const user = await makeUser("history-bucket");
    await seedInterestCredit(user.id, "10.00000000", DAY1_NOON);
    await seedInterestCredit(user.id, "5.00000000", DAY1_NOON);
    await seedInterestCredit(user.id, "7.50000000", DAY2_NOON);

    const history = await getDailyInterestHistoryA(user.id, DAY1_NOON, DAY3_NOON);

    expect(history.get("2026-06-08")?.toString()).toBe("15");
    expect(history.get("2026-06-09")?.toString()).toBe("7.5");
    expect(history.has("2026-06-10")).toBe(false);
  });

  it("excludes credits outside the requested range", async () => {
    const user = await makeUser("history-outside-range");
    await seedInterestCredit(user.id, "999.00000000", BEFORE_RANGE_NOON);
    await seedInterestCredit(user.id, "999.00000000", AFTER_RANGE_NOON);
    await seedInterestCredit(user.id, "12.00000000", DAY2_NOON);

    const history = await getDailyInterestHistoryA(user.id, DAY1_NOON, DAY3_NOON);

    expect([...history.keys()]).toEqual(["2026-06-09"]);
  });

  it("excludes other entry types and other wallets", async () => {
    const user = await makeUser("history-otherentries");
    await prisma.ledgerEntry.create({
      data: {
        userId: user.id,
        wallet: "A",
        direction: "CREDIT",
        amount: new Prisma.Decimal("40"),
        entryType: "ADMIN_CREDIT",
        comment: "Not daily interest.",
        idempotencyKey: `test:${crypto.randomUUID()}`,
        createdAt: DAY2_NOON,
      },
    });
    await prisma.ledgerEntry.create({
      data: {
        userId: user.id,
        wallet: "C",
        direction: "CREDIT",
        amount: new Prisma.Decimal("40"),
        entryType: "DAILY_INTEREST",
        comment: "Wrong wallet.",
        idempotencyKey: `test:${crypto.randomUUID()}`,
        createdAt: DAY2_NOON,
      },
    });

    const history = await getDailyInterestHistoryA(user.id, DAY1_NOON, DAY3_NOON);

    expect(history.size).toBe(0);
  });

  it("returns an empty map for a range with no credits", async () => {
    const user = await makeUser("history-empty");

    const history = await getDailyInterestHistoryA(user.id, DAY1_NOON, DAY3_NOON);

    expect(history.size).toBe(0);
  });
});
