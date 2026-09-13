import { afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { hashToken } from "./token-hash";
import { requirePermission } from "./route-guard";
import { login } from "./auth";
import { adminCreateUser, suspendUser, registerAsRoot } from "./users";
import { searchUsers, getUserDetail } from "./user-management";
import { cleanupLedgerEntriesForUsers } from "./test-helpers";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeSubAdmin(permissions: string[] = []) {
  const subAdmin = await prisma.user.create({
    data: {
      email: `um-subadmin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Sub-Admin",
      role: "ADMIN",
      isMainAdmin: false,
    },
  });
  createdUserIds.push(subAdmin.id);
  if (permissions.length > 0) {
    await prisma.adminPermissionGrant.createMany({
      data: permissions.map((permission) => ({
        adminUserId: subAdmin.id,
        permission: permission as never,
      })),
    });
  }
  return subAdmin;
}

async function makePlainUser(overrides: { name?: string; email?: string } = {}) {
  const user = await prisma.user.create({
    data: {
      email: overrides.email ?? `um-plain-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: overrides.name ?? "Plain User",
      role: "USER",
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function getMainAdmin() {
  return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
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

afterAll(async () => {
  await cleanupLedgerEntriesForUsers(createdUserIds);
  await prisma.adminAction.deleteMany({
    where: { OR: [{ targetUserId: { in: createdUserIds } }, { adminId: { in: createdUserIds } }] },
  });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.binaryNode.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("route-level enforcement", () => {
  it("a sub-admin without USER_MANAGEMENT is rejected at the route level", async () => {
    const subAdmin = await makeSubAdmin();
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    await expect(requirePermission("USER_MANAGEMENT", now, token)).rejects.toMatchObject({ status: 403 });
  });

  it("a sub-admin with USER_MANAGEMENT is allowed at the route level", async () => {
    const subAdmin = await makeSubAdmin(["USER_MANAGEMENT"]);
    const now = new Date();
    const token = await makeSessionToken(subAdmin.id, now);

    const resolved = await requirePermission("USER_MANAGEMENT", now, token);
    expect(resolved.id).toBe(subAdmin.id);
  });

  it("the main admin reaches it with zero explicit grants", async () => {
    const mainAdmin = await getMainAdmin();
    const now = new Date();
    const token = await makeSessionToken(mainAdmin.id, now);

    const resolved = await requirePermission("USER_MANAGEMENT", now, token);
    expect(resolved.id).toBe(mainAdmin.id);
  });
});

describe("creating a user with a sponsor", () => {
  it("correctly sets sponsorId", async () => {
    const mainAdmin = await getMainAdmin();
    const sponsor = await registerAsRoot({
      email: `um-sponsor-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Sponsor",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(sponsor.id);

    const created = await adminCreateUser(mainAdmin.id, {
      email: `um-created-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Created With Sponsor",
      sponsorId: sponsor.id,
      reason: "Onboarding a referred walk-in.",
    });
    createdUserIds.push(created.id);

    expect(created.sponsorId).toBe(sponsor.id);

    const detail = await getUserDetail(mainAdmin.id, sponsor.id);
    expect(detail.referralCount).toBe(1);
  });
});

describe("suspending a user blocks login immediately", () => {
  it("login is rejected right after suspension", async () => {
    const passwordHash = await import("./password").then((m) => m.hashPassword("password123"));
    const user = await prisma.user.create({
      data: {
        email: `um-suspendlogin-${crypto.randomUUID()}@test.local`,
        passwordHash,
        name: "Suspend Login Test",
        role: "USER",
      },
    });
    createdUserIds.push(user.id);
    const mainAdmin = await getMainAdmin();

    const before = await login({ email: user.email, password: "password123" }, new Date(), "10.0.0.2");
    expect(before.status).toBe("authenticated");

    await suspendUser(mainAdmin.id, user.id, { reason: "Fraud check." }, new Date());

    await expect(
      login({ email: user.email, password: "password123" }, new Date(), "10.0.0.2"),
    ).rejects.toThrow(/invalid email or password/i);
  });
});

describe("searchUsers", () => {
  it("matches by partial name, case-insensitively", async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    const user = await makePlainUser({ name: `ZebraFinch-${marker}` });

    const result = await searchUsers((await getMainAdmin()).id, { query: `zebrafinch-${marker}` });
    expect(result.users.some((u) => u.id === user.id)).toBe(true);
  });

  it("matches by partial email, case-insensitively", async () => {
    const marker = crypto.randomUUID();
    const user = await makePlainUser({ email: `Mixed-Case-${marker}@Test.Local` });

    const result = await searchUsers((await getMainAdmin()).id, { query: marker.toUpperCase() });
    expect(result.users.some((u) => u.id === user.id)).toBe(true);
  });

  it("excludes users that do not match the query", async () => {
    const marker = crypto.randomUUID();
    await makePlainUser({ name: `NoMatchHere-${marker}` });

    const result = await searchUsers((await getMainAdmin()).id, { query: `totally-unrelated-${crypto.randomUUID()}` });
    expect(result.users).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("paginates results", async () => {
    const marker = crypto.randomUUID().slice(0, 8);
    for (let i = 0; i < 3; i++) {
      await makePlainUser({ name: `PagedUser-${marker}-${i}` });
    }

    const page1 = await searchUsers((await getMainAdmin()).id, { query: `PagedUser-${marker}`, page: 1 });
    expect(page1.total).toBe(3);
    expect(page1.users).toHaveLength(3);
  });

  it("rejects a caller with neither USER_MANAGEMENT nor CREDIT_ISSUANCE", async () => {
    const subAdmin = await makeSubAdmin();
    await expect(searchUsers(subAdmin.id, {})).rejects.toThrow(/forbidden/i);
  });

  it("allows a sub-admin with only CREDIT_ISSUANCE (SCRUM-106: the credit-issuance user picker needs search without USER_MANAGEMENT)", async () => {
    const subAdmin = await makeSubAdmin(["CREDIT_ISSUANCE"]);
    const result = await searchUsers(subAdmin.id, {});
    expect(result).toHaveProperty("users");
  });

  it("rejects a non-admin caller", async () => {
    const user = await makePlainUser();
    await expect(searchUsers(user.id, {})).rejects.toThrow(/forbidden/i);
  });
});

describe("getUserDetail", () => {
  it("returns wallet balances, active investment count, referral count, and null rank for a fresh user", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makePlainUser();

    const detail = await getUserDetail(mainAdmin.id, user.id);

    expect(detail.wallets.A.toString()).toBe("0");
    expect(detail.wallets.B.toString()).toBe("0");
    expect(detail.wallets.C.toString()).toBe("0");
    expect(detail.wallets.SAVING.toString()).toBe("0");
    expect(detail.activeInvestmentCount).toBe(0);
    expect(detail.referralCount).toBe(0);
    expect(detail.currentRank).toBeNull();
  });

  it("rejects a caller without USER_MANAGEMENT", async () => {
    const subAdmin = await makeSubAdmin();
    const user = await makePlainUser();

    await expect(getUserDetail(subAdmin.id, user.id)).rejects.toThrow(/forbidden/i);
  });

  it("allows a sub-admin with USER_MANAGEMENT", async () => {
    const subAdmin = await makeSubAdmin(["USER_MANAGEMENT"]);
    const user = await makePlainUser();

    const detail = await getUserDetail(subAdmin.id, user.id);
    expect(detail.id).toBe(user.id);
  });
});
