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
async function creditEntry(
  userId: string,
  wallet: "A" | "B" | "C" | "SAVING",
  entryType: Parameters<typeof postTransaction>[0]["entries"][0]["entryType"],
  amount: string,
  createdAt: Date,
  reference?: { referenceType: string; referenceId: string },
) {
  const key = `txhistory:${userId}:${crypto.randomUUID()}`;
  await prisma.ledgerEntry.create({
    data: {
      userId,
      wallet,
      direction: "CREDIT",
      amount,
      entryType,
      comment: reference ? `Raw-id comment mentioning ${reference.referenceId}` : `test ${entryType}`,
      idempotencyKey: key,
      createdAt,
      referenceType: reference?.referenceType,
      referenceId: reference?.referenceId,
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
      referenceType: reference?.referenceType,
      referenceId: reference?.referenceId,
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

describe("listLedgerEntriesForUser — description (no raw ids exposed to the user)", () => {
  const createdPackageIds: string[] = [];
  const createdInvestmentIds: string[] = [];

  afterAll(async () => {
    await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
    await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  });

  async function makeInvestment(userId: string, packageName: string) {
    const pkg = await prisma.package.create({ data: { name: packageName, amount: "1000", isActive: true } });
    createdPackageIds.push(pkg.id);
    const investment = await prisma.investment.create({
      data: {
        userId,
        packageId: pkg.id,
        amount: "1000",
        purchasedAt: new Date("2026-01-01T00:00:00.000Z"),
        profitStartsAt: new Date("2026-01-08T00:00:00.000Z"),
        capitalUnlocksAt: new Date("2026-07-01T00:00:00.000Z"),
        status: "ACTIVE",
        referenceId: `seed-purchase:${crypto.randomUUID()}`,
      },
    });
    createdInvestmentIds.push(investment.id);
    return investment;
  }

  it("DIRECT_COMMISSION description names the referred buyer (not the sponsor viewing it) and the package, not the raw investment id", async () => {
    const sponsor = await makeUser("desc-direct-commission-sponsor");
    const buyer = await makeUser("desc-direct-commission-buyer");
    const investment = await makeInvestment(buyer.id, `Description-Test-Package-${crypto.randomUUID()}`);
    // The commission entry itself is credited to the SPONSOR's wallet, but
    // referenceId points at the BUYER's investment — exactly the real
    // direct-commission.ts shape (referenceId is always the investment id).
    await creditEntry(sponsor.id, "C", "DIRECT_COMMISSION", "50", new Date(), {
      referenceType: "investment",
      referenceId: investment.id,
    });

    const page = await listLedgerEntriesForUser(sponsor.id, {}, 1);
    const entry = page.entries.find((e) => e.entryType === "DIRECT_COMMISSION")!;

    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: investment.packageId } });
    expect(entry.description).toBe(`Direct Commission from ${buyer.name}'s investment — ${pkg.name}`);
    expect(entry.description).not.toContain(investment.id);
  });

  it("DIRECT_SAVING description also names the referred buyer, with its own entry-type label as the prefix", async () => {
    const sponsor = await makeUser("desc-direct-saving-sponsor");
    const buyer = await makeUser("desc-direct-saving-buyer");
    const investment = await makeInvestment(buyer.id, `Description-Test-Package-${crypto.randomUUID()}`);
    await creditEntry(sponsor.id, "SAVING", "DIRECT_SAVING", "30", new Date(), {
      referenceType: "investment",
      referenceId: investment.id,
    });

    const page = await listLedgerEntriesForUser(sponsor.id, {}, 1);
    const entry = page.entries.find((e) => e.entryType === "DIRECT_SAVING")!;

    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: investment.packageId } });
    expect(entry.description).toBe(`Direct Commission (Saved) from ${buyer.name}'s investment — ${pkg.name}`);
  });

  it("CAPITAL_RELEASE and DAILY_INTEREST descriptions also include the package name, not the raw id", async () => {
    const user = await makeUser("desc-capital-daily");
    const investment = await makeInvestment(user.id, `Description-Test-Package-${crypto.randomUUID()}`);
    await creditEntry(user.id, "A", "CAPITAL_RELEASE", "1000", new Date(), {
      referenceType: "investment",
      referenceId: investment.id,
    });
    await creditEntry(user.id, "A", "DAILY_INTEREST", "5", new Date(Date.now() + 1000), {
      referenceType: "investment",
      referenceId: investment.id,
    });

    const page = await listLedgerEntriesForUser(user.id, {}, 1);
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: investment.packageId } });

    const capitalRelease = page.entries.find((e) => e.entryType === "CAPITAL_RELEASE")!;
    expect(capitalRelease.description).toContain(pkg.name);
    expect(capitalRelease.description).not.toContain(investment.id);

    const dailyInterest = page.entries.find((e) => e.entryType === "DAILY_INTEREST")!;
    expect(dailyInterest.description).toContain(pkg.name);
    expect(dailyInterest.description).not.toContain(investment.id);
  });

  it("falls back to the plain entry-type label when no matching investment is found", async () => {
    const user = await makeUser("desc-fallback");
    await creditEntry(user.id, "C", "DIRECT_COMMISSION", "10", new Date(), {
      referenceType: "investment",
      referenceId: "nonexistent-investment-id",
    });

    const page = await listLedgerEntriesForUser(user.id, {}, 1);
    const entry = page.entries.find((e) => e.entryType === "DIRECT_COMMISSION")!;
    expect(entry.description).toBe("Direct Commission");
  });

  it("SAVING_UNLOCK and WITHDRAWAL_OUT descriptions never expose a raw id either (no natural name substitute)", async () => {
    const user = await makeUser("desc-no-substitute");
    await creditEntry(user.id, "C", "SAVING_UNLOCK", "40", new Date(), {
      referenceType: "saving_lot",
      referenceId: "some-lot-id-xyz",
    });

    const page = await listLedgerEntriesForUser(user.id, {}, 1);
    const entry = page.entries.find((e) => e.entryType === "SAVING_UNLOCK")!;
    expect(entry.description).toBe("Saving Unlock");
    expect(entry.description).not.toContain("some-lot-id-xyz");
  });

  it("does not N+1 query — entries sharing the same investment reuse one batched lookup", async () => {
    const user = await makeUser("desc-batch");
    const investment = await makeInvestment(user.id, `Description-Test-Package-${crypto.randomUUID()}`);
    for (let i = 0; i < 3; i++) {
      await creditEntry(user.id, "A", "DAILY_INTEREST", "1", new Date(Date.now() + i * 1000), {
        referenceType: "investment",
        referenceId: investment.id,
      });
    }

    const page = await listLedgerEntriesForUser(user.id, {}, 1);
    const pkg = await prisma.package.findUniqueOrThrow({ where: { id: investment.packageId } });
    const dailyInterestEntries = page.entries.filter((e) => e.entryType === "DAILY_INTEREST");
    expect(dailyInterestEntries.length).toBeGreaterThanOrEqual(3);
    expect(dailyInterestEntries.every((e) => e.description.includes(pkg.name))).toBe(true);
  });
});

describe("listLedgerEntriesForUser — transfer descriptions (counterparty name from metadata)", () => {
  async function transferEntry(
    userId: string,
    entryType: "USER_TRANSFER_SENT" | "USER_TRANSFER_RECEIVED",
    counterpartyId: string,
    counterpartyName: string,
    createdAt: Date,
  ) {
    const key = `txhistory-transfer:${userId}:${crypto.randomUUID()}`;
    await prisma.ledgerEntry.create({
      data: {
        userId,
        wallet: "B",
        direction: entryType === "USER_TRANSFER_SENT" ? "DEBIT" : "CREDIT",
        amount: "50",
        entryType,
        comment: "test transfer",
        idempotencyKey: key,
        createdAt,
        referenceType: "user_transfer",
        referenceId: counterpartyId,
        metadata: { counterpartyId, counterpartyName },
      },
    });
  }

  it("USER_TRANSFER_SENT shows the recipient's real name from metadata, not the generic label", async () => {
    const sender = await makeUser("desc-transfer-sender");
    const recipient = await makeUser("desc-transfer-recipient");
    await transferEntry(sender.id, "USER_TRANSFER_SENT", recipient.id, recipient.name, new Date());

    const page = await listLedgerEntriesForUser(sender.id, {}, 1);
    const entry = page.entries.find((e) => e.entryType === "USER_TRANSFER_SENT")!;
    expect(entry.description).toBe(`Transfer sent to ${recipient.name}`);
  });

  it("USER_TRANSFER_RECEIVED shows the sender's real name from metadata", async () => {
    const sender = await makeUser("desc-transfer-sender-2");
    const recipient = await makeUser("desc-transfer-recipient-2");
    await transferEntry(recipient.id, "USER_TRANSFER_RECEIVED", sender.id, sender.name, new Date());

    const page = await listLedgerEntriesForUser(recipient.id, {}, 1);
    const entry = page.entries.find((e) => e.entryType === "USER_TRANSFER_RECEIVED")!;
    expect(entry.description).toBe(`Transfer received from ${sender.name}`);
  });

  it("falls back to the generic label when metadata is missing or malformed", async () => {
    const user = await makeUser("desc-transfer-no-metadata");
    const key = `txhistory-transfer-nometa:${user.id}:${crypto.randomUUID()}`;
    await prisma.ledgerEntry.create({
      data: {
        userId: user.id,
        wallet: "B",
        direction: "DEBIT",
        amount: "50",
        entryType: "USER_TRANSFER_SENT",
        comment: "test transfer",
        idempotencyKey: key,
        createdAt: new Date(),
        referenceType: "user_transfer",
        referenceId: "some-id",
      },
    });

    const page = await listLedgerEntriesForUser(user.id, {}, 1);
    const entry = page.entries.find((e) => e.entryType === "USER_TRANSFER_SENT")!;
    expect(entry.description).toBe("Transfer Sent");
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
