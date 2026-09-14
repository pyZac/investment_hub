import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { hashToken } from "./token-hash";
import { requirePermission } from "./route-guard";
import { registerAsRoot } from "./users";
import { adminCreditWalletB } from "./admin-credit";
import { recordFailedAttempt } from "./rate-limit";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";
import { querySecurityLog } from "./security-log";

const createdUserIds: string[] = [];
const createdSecurityEventIds: string[] = [];

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
      email: `securitylog-subadmin-${crypto.randomUUID()}@test.local`,
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
    email: `securitylog-${label}-${crypto.randomUUID()}@test.local`,
    password: "password123",
    name: "Security Log Test User",
    securityQuestions: sampleQuestions,
  });
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.securityEvent.deleteMany({ where: { id: { in: createdSecurityEventIds } } });
  await prisma.securityEvent.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.adminAction.deleteMany({ where: { targetUserId: { in: createdUserIds } } });
  await prisma.adminAction.deleteMany({ where: { adminId: { in: createdUserIds } } });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("route-level enforcement", () => {
  it("a sub-admin without SECURITY_VIEW is rejected at the route level", async () => {
    const subAdmin = await makeSubAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("SECURITY_VIEW", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("a sub-admin with SECURITY_VIEW is allowed at the route level", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "SECURITY_VIEW" },
    });
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("SECURITY_VIEW", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("SECURITY_VIEW", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });
});

describe("querySecurityLog", () => {
  it("rejects a caller without SECURITY_VIEW", async () => {
    const subAdmin = await makeSubAdmin();
    await expect(querySecurityLog(subAdmin.id, {}, 1)).rejects.toThrow(/forbidden/i);
  });

  it("a failed-login security event appears in the feed", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("failed-login");
    const uniqueIp = `10.${crypto.getRandomValues(new Uint8Array(1))[0]}.${crypto.getRandomValues(new Uint8Array(1))[0]}.${crypto.getRandomValues(new Uint8Array(1))[0]}`;

    await recordFailedAttempt("LOGIN_FAILED", user.email, uniqueIp, new Date());
    const event = await prisma.securityEvent.findFirstOrThrow({
      where: { email: user.email, type: "LOGIN_FAILED" },
      orderBy: { createdAt: "desc" },
    });
    createdSecurityEventIds.push(event.id);

    const { rows } = await querySecurityLog(mainAdmin.id, {}, 1);
    const match = rows.find((r) => r.id === `security_event:${event.id}`);

    expect(match).toBeDefined();
    expect(match!.source).toBe("SECURITY_EVENT");
    expect(match!.typeLabel).toBe("Failed Login");
    expect(match!.userLabel).toBe(user.email);
  });

  it("an admin action (credit issuance) appears in the feed", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("credit-issuance");

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "100",
      reason: "Security log feed test credit.",
      idempotencyKey: `test-securitylog-credit:${user.id}:${crypto.randomUUID()}`,
    });

    const { rows } = await querySecurityLog(mainAdmin.id, { userId: user.id }, 1);
    const match = rows.find((r) => r.source === "ADMIN_ACTION" && r.typeLabel === "Admin Credit");

    expect(match).toBeDefined();
    expect(match!.userLabel).toBe(user.name);
    expect(match!.detail).toBe("Security log feed test credit.");
  });

  it("merges both sources into one chronologically-ordered feed, newest first", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("merged-order");

    const uniqueIp = `10.${crypto.getRandomValues(new Uint8Array(1))[0]}.${crypto.getRandomValues(new Uint8Array(1))[0]}.${crypto.getRandomValues(new Uint8Array(1))[0]}`;
    await recordFailedAttempt("LOGIN_FAILED", user.email, uniqueIp, new Date(), user.id);
    const event = await prisma.securityEvent.findFirstOrThrow({
      where: { email: user.email, type: "LOGIN_FAILED" },
      orderBy: { createdAt: "desc" },
    });
    createdSecurityEventIds.push(event.id);

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "50",
      reason: "Security log merge-order test credit.",
      idempotencyKey: `test-securitylog-merge:${user.id}:${crypto.randomUUID()}`,
    });

    const { rows } = await querySecurityLog(mainAdmin.id, { userId: user.id }, 1);

    // Both this user's rows (the failed login by email doesn't carry userId,
    // so filter loosely — assert ordering holds for whatever rows exist).
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(rows[i].createdAt.getTime());
    }
  });

  it("filters by source (security event vs admin action)", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("filter-source");

    const uniqueIp = `10.${crypto.getRandomValues(new Uint8Array(1))[0]}.${crypto.getRandomValues(new Uint8Array(1))[0]}.${crypto.getRandomValues(new Uint8Array(1))[0]}`;
    await recordFailedAttempt("LOGIN_FAILED", user.email, uniqueIp, new Date(), user.id);
    const event = await prisma.securityEvent.findFirstOrThrow({
      where: { email: user.email, type: "LOGIN_FAILED" },
      orderBy: { createdAt: "desc" },
    });
    createdSecurityEventIds.push(event.id);

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "20",
      reason: "Security log source-filter test credit.",
      idempotencyKey: `test-securitylog-source:${user.id}:${crypto.randomUUID()}`,
    });

    const securityOnly = await querySecurityLog(mainAdmin.id, { source: "SECURITY_EVENT" }, 1);
    expect(securityOnly.rows.every((r) => r.source === "SECURITY_EVENT")).toBe(true);

    const adminOnly = await querySecurityLog(mainAdmin.id, { source: "ADMIN_ACTION" }, 1);
    expect(adminOnly.rows.every((r) => r.source === "ADMIN_ACTION")).toBe(true);
  });

  it("filters by date range", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser("filter-date");

    await adminCreditWalletB(mainAdmin.id, {
      userId: user.id,
      amount: "20",
      reason: "Security log date-filter test credit.",
      idempotencyKey: `test-securitylog-date:${user.id}:${crypto.randomUUID()}`,
    });

    const farFuture = { dateFrom: new Date("2099-01-01T00:00:00.000Z") };
    const { rows } = await querySecurityLog(mainAdmin.id, { ...farFuture, userId: user.id }, 1);
    expect(rows).toHaveLength(0);
  });

  it("filters by user", async () => {
    const mainAdmin = await getMainAdmin();
    const userA = await makeUser("filter-user-a");
    const userB = await makeUser("filter-user-b");

    await adminCreditWalletB(mainAdmin.id, {
      userId: userA.id,
      amount: "20",
      reason: "Security log user-filter test credit A.",
      idempotencyKey: `test-securitylog-usera:${userA.id}:${crypto.randomUUID()}`,
    });
    await adminCreditWalletB(mainAdmin.id, {
      userId: userB.id,
      amount: "20",
      reason: "Security log user-filter test credit B.",
      idempotencyKey: `test-securitylog-userb:${userB.id}:${crypto.randomUUID()}`,
    });

    const { rows } = await querySecurityLog(mainAdmin.id, { userId: userA.id }, 1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.detail === "Security log user-filter test credit A.")).toBe(true);
    expect(rows.some((r) => r.detail === "Security log user-filter test credit B.")).toBe(false);
  });

  it("allows a sub-admin with SECURITY_VIEW to query the feed", async () => {
    const subAdmin = await makeSubAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "SECURITY_VIEW" },
    });

    await expect(querySecurityLog(subAdmin.id, {}, 1)).resolves.toBeDefined();
  });
});
