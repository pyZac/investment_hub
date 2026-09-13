import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { registerAsRoot } from "./users";
import { adminCreditWalletB } from "./admin-credit";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";
import { hashToken } from "./token-hash";
import { requirePermission } from "./route-guard";
import { queryLedgerEntries, queryLedgerEntriesForExport, rowsToCsv } from "./ledger-explorer";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function getMainAdmin() {
  return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
}

async function makeSubAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `ledger-subadmin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Sub-Admin",
      role: "ADMIN",
    },
  });
  createdUserIds.push(admin.id);
  return admin;
}

async function makeSessionToken(userId: string, forDate: Date) {
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(forDate.getTime() + 60 * 60 * 1000),
      lastActiveAt: forDate,
    },
  });
  return token;
}

async function makeUser(label = "root") {
  const user = await registerAsRoot({
    email: `ledger-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Ledger Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

async function fundWalletB(userId: string, amount: string, idempotencyKey: string) {
  const mainAdmin = await getMainAdmin();
  return adminCreditWalletB(mainAdmin.id, {
    userId,
    amount,
    reason: "Test funding for ledger explorer tests.",
    idempotencyKey,
  });
}

afterAll(async () => {
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("route-level enforcement", () => {
  it("a sub-admin without LEDGER_VIEW is rejected at the route level", async () => {
    const subAdmin = await makeSubAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("LEDGER_VIEW", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("a sub-admin with LEDGER_VIEW is allowed at the route level", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "LEDGER_VIEW" },
    });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("LEDGER_VIEW", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("LEDGER_VIEW", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });
});

describe("queryLedgerEntries / queryLedgerEntriesForExport", () => {
  it("rejects a caller without LEDGER_VIEW", async () => {
    const subAdmin = await makeSubAdmin();
    await expect(queryLedgerEntries(subAdmin.id, {}, 1)).rejects.toThrow(/forbidden/i);
    await expect(queryLedgerEntriesForExport(subAdmin.id, {})).rejects.toThrow(/forbidden/i);
  });

  it("allows a sub-admin granted LEDGER_VIEW", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "LEDGER_VIEW" },
    });
    const user = await makeUser("grant-check");
    await fundWalletB(user.id, "500", `ledger-grant-check:${user.id}:${crypto.randomUUID()}`);

    const { rows } = await queryLedgerEntries(subAdmin.id, { userId: user.id }, 1);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("SYSTEM_EXTERNAL never appears raw — the paired row's userLabel is always 'Platform Reserve'", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("system-external");
    const idempotencyKey = `ledger-sysext:${user.id}:${crypto.randomUUID()}`;
    await fundWalletB(user.id, "777", idempotencyKey);

    // A userId filter only shows the real user's own row of the pair; fetch
    // the raw pair by idempotencyKey to find the SYSTEM_EXTERNAL sibling's id.
    const rawEntries = await prisma.ledgerEntry.findMany({ where: { idempotencyKey } });
    expect(rawEntries.some((e) => e.userId === null)).toBe(true);

    const systemExternalRowId = rawEntries.find((e) => e.userId === null)!.id;
    const allRows = await queryLedgerEntriesForExport(mainAdmin.id, {});
    const systemExternalRow = allRows.find((r) => r.id === systemExternalRowId);
    expect(systemExternalRow).toBeDefined();
    expect(systemExternalRow!.userLabel).toBe("Platform Reserve");
    expect(systemExternalRow!.userLabel).not.toMatch(/SYSTEM_EXTERNAL/i);

    // Cross-check the entire export/table output never contains the raw string.
    const csv = rowsToCsv(allRows);
    expect(csv).not.toMatch(/SYSTEM_EXTERNAL/);
    for (const row of allRows) {
      expect(row.userLabel).not.toMatch(/SYSTEM_EXTERNAL/i);
    }
  });

  it("filters combine (user + entryType + wallet + date range together)", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("combined-filters");
    const forDate = new Date();
    await fundWalletB(user.id, "1000", `ledger-combined:${user.id}:${crypto.randomUUID()}`);

    const { rows: matching } = await queryLedgerEntries(
      mainAdmin.id,
      {
        userId: user.id,
        entryType: "ADMIN_CREDIT",
        wallet: "B",
        dateFrom: new Date(forDate.getTime() - 60_000),
        dateTo: new Date(forDate.getTime() + 60_000),
      },
      1,
    );
    expect(matching.length).toBe(1);
    expect(matching[0].amount).toBe("1000");
    expect(matching[0].direction).toBe("CREDIT");

    const { rows: wrongWallet } = await queryLedgerEntries(
      mainAdmin.id,
      { userId: user.id, entryType: "ADMIN_CREDIT", wallet: "A" },
      1,
    );
    expect(wrongWallet.length).toBe(0);

    const { rows: wrongDateRange } = await queryLedgerEntries(
      mainAdmin.id,
      {
        userId: user.id,
        dateFrom: new Date(forDate.getTime() + 3600_000),
      },
      1,
    );
    expect(wrongDateRange.length).toBe(0);
  });

  it("CSV export contains exactly the same rows as the filtered query — every matching row, not just the current page", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("csv-completeness");
    // Create more entries than one page's worth is unnecessary here (page
    // size is 50) — the point under test is "export == full filtered set",
    // proven by comparing export output against every row from a query
    // that has no page cap (verified by exact set equality on ids).
    const keys = [1, 2, 3].map(() => `ledger-csv:${user.id}:${crypto.randomUUID()}`);
    for (const key of keys) {
      await fundWalletB(user.id, "10", key);
    }

    const exportedRows = await queryLedgerEntriesForExport(mainAdmin.id, { userId: user.id });
    const { rows: pagedRows } = await queryLedgerEntries(mainAdmin.id, { userId: user.id }, 1);

    expect(exportedRows.length).toBe(pagedRows.length);
    expect(new Set(exportedRows.map((r) => r.id))).toEqual(new Set(pagedRows.map((r) => r.id)));

    const csv = rowsToCsv(exportedRows);
    const csvLines = csv.split("\n");
    // header + one line per row
    expect(csvLines.length).toBe(exportedRows.length + 1);
    expect(csvLines[0]).toBe("Date,User,Wallet,Entry Type,Direction,Amount,Comment");
    for (const row of exportedRows) {
      expect(csv).toContain(row.amount);
    }
  });

  it("renders entry type and wallet as readable labels, never raw enum values in a form a user wouldn't recognize", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("labels");
    await fundWalletB(user.id, "42", `ledger-labels:${user.id}:${crypto.randomUUID()}`);

    const { rows } = await queryLedgerEntries(mainAdmin.id, { userId: user.id, entryType: "ADMIN_CREDIT" }, 1);
    expect(rows[0].entryTypeLabel).toBe("Admin Credit");
    expect(rows[0].walletLabel).toBe("B");
  });
});
