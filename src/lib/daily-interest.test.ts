import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { accrueDailyInterestForInvestment } from "./daily-interest";

const createdUserIds: string[] = [];
const createdPackageIds: string[] = [];
const createdInvestmentIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser() {
  const user = await registerAsRoot({
    email: `interest-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Interest User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function makePackage(amount: string) {
  const pkg = await prisma.package.create({
    data: { name: `Test-${crypto.randomUUID()}`, amount, isActive: true },
  });
  createdPackageIds.push(pkg.id);
  return pkg;
}

async function makeInvestment(
  userId: string,
  packageAmount: string,
  purchasedAt: Date,
  overrides: { capitalUnlocksAt?: Date } = {},
) {
  const pkg = await makePackage(packageAmount);
  const profitStartsAt = new Date(purchasedAt);
  profitStartsAt.setUTCDate(profitStartsAt.getUTCDate() + 7);
  const capitalUnlocksAt = overrides.capitalUnlocksAt ?? new Date(purchasedAt);
  if (!overrides.capitalUnlocksAt) {
    capitalUnlocksAt.setUTCMonth(capitalUnlocksAt.getUTCMonth() + 6);
  }

  const investment = await prisma.investment.create({
    data: {
      userId,
      packageId: pkg.id,
      amount: packageAmount,
      purchasedAt,
      profitStartsAt,
      capitalUnlocksAt,
      referenceId: `seed-purchase:${crypto.randomUUID()}`,
    },
  });
  createdInvestmentIds.push(investment.id);
  return investment;
}

async function disableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" DISABLE TRIGGER ledger_entries_no_delete`);
}

async function enableDeleteTrigger() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "ledger_entries" ENABLE TRIGGER ledger_entries_no_delete`);
}

afterAll(async () => {
  await prisma.investment.deleteMany({ where: { id: { in: createdInvestmentIds } } });
  await disableDeleteTrigger();
  await prisma.ledgerEntry.deleteMany({
    where: { referenceType: "investment", referenceId: { in: createdInvestmentIds } },
  });
  await enableDeleteTrigger();
  await prisma.package.deleteMany({ where: { id: { in: createdPackageIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("accrueDailyInterestForInvestment", () => {
  it("skips (no ledger entry) before profit_starts_at", async () => {
    const user = await makeUser();
    // purchased 2026-08-20 -> profitStartsAt 2026-08-27; day 6 (08-26) is before that.
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-20T00:00:00.000Z"));

    const result = await accrueDailyInterestForInvestment(
      investment.id,
      new Date("2026-08-26T06:00:00.000Z"),
    );

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("before_profit_start");

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "investment", referenceId: investment.id },
    });
    expect(entries).toHaveLength(0);
  });

  it("skips entirely on a Friday, not accrued at zero", async () => {
    const user = await makeUser();
    // purchased 2026-08-01 -> profitStartsAt 2026-08-08, well before the Friday tested.
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-01T00:00:00.000Z"));

    // 2026-08-21 is a Friday.
    const friday = new Date("2026-08-21T06:00:00.000Z");
    const result = await accrueDailyInterestForInvestment(investment.id, friday);

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("friday");

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "investment", referenceId: investment.id },
    });
    expect(entries).toHaveLength(0);
  });

  it("skips if the investment owner is suspended", async () => {
    const user = await makeUser();
    const investment = await makeInvestment(user.id, "1000", new Date("2026-08-01T00:00:00.000Z"));
    await prisma.user.update({ where: { id: user.id }, data: { suspendedAt: new Date("2026-08-10T00:00:00.000Z") } });

    const result = await accrueDailyInterestForInvestment(
      investment.id,
      new Date("2026-08-20T06:00:00.000Z"),
    );

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe("owner_suspended");

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceType: "investment", referenceId: investment.id },
    });
    expect(entries).toHaveLength(0);
  });

  it("credits dailyRate(date) x principal on day 8, tagged to the investment, balanced against SYSTEM_EXTERNAL", async () => {
    const user = await makeUser();
    const purchasedAt = new Date("2026-08-13T00:00:00.000Z");
    const investment = await makeInvestment(user.id, "1000", purchasedAt);
    // profitStartsAt = 2026-08-20. First accrual day = 2026-08-20 (not a Friday).

    const forDate = new Date("2026-08-20T06:00:00.000Z");
    const idempotencyKey = `daily_interest:${user.id}:${investment.id}:2026-08-20`;

    const result = await accrueDailyInterestForInvestment(investment.id, forDate);

    expect(result.skipped).toBe(false);

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(entries).toHaveLength(2);

    const credit = entries.find((e) => e.direction === "CREDIT")!;
    const debit = entries.find((e) => e.direction === "DEBIT")!;
    expect(credit.userId).toBe(user.id);
    expect(credit.wallet).toBe("A");
    expect(credit.entryType).toBe("DAILY_INTEREST");
    expect(credit.referenceType).toBe("investment");
    expect(credit.referenceId).toBe(investment.id);
    // purchasedAt 2026-08-13 -> forDate 2026-08-20 is 7 elapsed days, day 8
    // in the docs' 1-indexed convention (purchase day = day 1, accrual
    // begins "day 8 onward").
    expect(credit.comment).toBe(`Daily interest for investment ${investment.id}, day 8.`);
    expect(credit.idempotencyKey).toBe(idempotencyKey);

    expect(debit.userId).toBeNull();
    expect(debit.wallet).toBe("SYSTEM_EXTERNAL");
    expect(debit.entryType).toBe("DAILY_INTEREST");
    expect(debit.comment).toBe(credit.comment);

    // August 2026: 31 days, 4 Fridays -> divisor 27. Active rate is 5%.
    const expectedRate = new Prisma.Decimal("5").div(27);
    const expectedAmount = expectedRate.mul("1000");
    expect(new Prisma.Decimal(credit.amount).toFixed(8)).toBe(expectedAmount.toFixed(8));
    expect(new Prisma.Decimal(debit.amount).toFixed(8)).toBe(expectedAmount.toFixed(8));
  });

  it("is idempotent: re-running for an already-processed date creates no duplicate entries", async () => {
    const user = await makeUser();
    const purchasedAt = new Date("2026-08-13T00:00:00.000Z");
    const investment = await makeInvestment(user.id, "1000", purchasedAt);
    const forDate = new Date("2026-08-20T06:00:00.000Z");
    const idempotencyKey = `daily_interest:${user.id}:${investment.id}:2026-08-20`;

    await accrueDailyInterestForInvestment(investment.id, forDate);
    await accrueDailyInterestForInvestment(investment.id, forDate);

    const entries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(entries).toHaveLength(2);
  });

  it("compounds: day N's credit is based on day N-1's already-grown balance, not the original principal", async () => {
    const user = await makeUser();
    const purchasedAt = new Date("2026-08-13T00:00:00.000Z");
    const investment = await makeInvestment(user.id, "1000", purchasedAt);
    // profitStartsAt = 2026-08-20. Accrue three consecutive non-Friday days:
    // 08-20 (Thu), 08-22 (Sat, since 08-21 is Friday and gets no entry), 08-23 (Sun).
    const day1 = new Date("2026-08-20T06:00:00.000Z");
    const friday = new Date("2026-08-21T06:00:00.000Z");
    const day2 = new Date("2026-08-22T06:00:00.000Z");
    const day3 = new Date("2026-08-23T06:00:00.000Z");

    const r1 = await accrueDailyInterestForInvestment(investment.id, day1);
    const rf = await accrueDailyInterestForInvestment(investment.id, friday);
    const r2 = await accrueDailyInterestForInvestment(investment.id, day2);
    const r3 = await accrueDailyInterestForInvestment(investment.id, day3);

    expect(rf.skipped).toBe(true);

    // August 2026 divisor = 27, rate 5%.
    const dailyRateValue = new Prisma.Decimal("5").div(27);
    const principal = new Prisma.Decimal("1000");

    const expectedDay1Amount = principal.mul(dailyRateValue);
    const balanceAfterDay1 = principal.add(expectedDay1Amount);

    const expectedDay2Amount = balanceAfterDay1.mul(dailyRateValue);
    const balanceAfterDay2 = balanceAfterDay1.add(expectedDay2Amount);

    const expectedDay3Amount = balanceAfterDay2.mul(dailyRateValue);

    expect(new Prisma.Decimal(r1.amount!).toFixed(8)).toBe(expectedDay1Amount.toFixed(8));
    expect(new Prisma.Decimal(r2.amount!).toFixed(8)).toBe(expectedDay2Amount.toFixed(8));
    expect(new Prisma.Decimal(r3.amount!).toFixed(8)).toBe(expectedDay3Amount.toFixed(8));

    // Day 3's credit must differ from day 1's (proves it's not re-using principal each time).
    expect(expectedDay3Amount.eq(expectedDay1Amount)).toBe(false);
  });
});
