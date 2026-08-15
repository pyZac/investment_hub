import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { registerAsRoot, registerWithSponsor, adminCreateUser } from "./users";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeAdmin() {
  const admin = await prisma.user.create({
    data: {
      email: `admin-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test Admin",
      role: "ADMIN",
    },
  });
  createdUserIds.push(admin.id);
  return admin;
}

async function getMainAdmin() {
  const admin = await prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
  return admin;
}

afterAll(async () => {
  await prisma.adminAction.deleteMany({
    where: { OR: [{ targetUserId: { in: createdUserIds } }, { adminId: { in: createdUserIds } }] },
  });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.walletAccount.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("registerAsRoot", () => {
  it("creates a user with no sponsor", async () => {
    const user = await registerAsRoot({
      email: `root-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Root User",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);

    expect(user.sponsorId).toBeNull();
    expect(user.role).toBe("USER");

    const questions = await prisma.securityQuestion.findMany({ where: { userId: user.id } });
    expect(questions).toHaveLength(3);
  });
});

describe("registerWithSponsor", () => {
  let sponsor: Awaited<ReturnType<typeof registerAsRoot>>;

  beforeAll(async () => {
    sponsor = await registerAsRoot({
      email: `sponsor-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Sponsor User",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(sponsor.id);
  });

  it("places the new user under the sponsor", async () => {
    const user = await registerWithSponsor(sponsor.id, {
      email: `referred-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Referred User",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(user.id);

    expect(user.sponsorId).toBe(sponsor.id);
  });

  it("rejects an unknown sponsor id", async () => {
    await expect(
      registerWithSponsor("nonexistent-id", {
        email: `orphan-${crypto.randomUUID()}@test.local`,
        password: "password123",
        name: "Orphan",
        securityQuestions: sampleQuestions,
      }),
    ).rejects.toThrow(/sponsor not found/i);
  });

  it("rejects a suspended sponsor", async () => {
    const suspended = await registerAsRoot({
      email: `suspended-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Suspended Sponsor",
      securityQuestions: sampleQuestions,
    });
    createdUserIds.push(suspended.id);
    await prisma.user.update({ where: { id: suspended.id }, data: { suspendedAt: new Date() } });

    await expect(
      registerWithSponsor(suspended.id, {
        email: `blocked-${crypto.randomUUID()}@test.local`,
        password: "password123",
        name: "Blocked",
        securityQuestions: sampleQuestions,
      }),
    ).rejects.toThrow(/suspended/i);
  });
});

describe("adminCreateUser", () => {
  it("main admin can create a user and it logs to admin_actions", async () => {
    const mainAdmin = await getMainAdmin();

    const user = await adminCreateUser(mainAdmin.id, {
      email: `admincreated-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Admin Created",
      reason: "Manual onboarding for a walk-in client.",
    });
    createdUserIds.push(user.id);

    expect(user.createdByAdminId).toBe(mainAdmin.id);

    const action = await prisma.adminAction.findFirst({
      where: { targetUserId: user.id, actionType: "USER_CREATED" },
    });
    expect(action).not.toBeNull();
    expect(action?.adminId).toBe(mainAdmin.id);
    expect(action?.reason).toMatch(/walk-in/);
  });

  it("rejects a sub-admin without USER_MANAGEMENT", async () => {
    const subAdmin = await makeAdmin();

    await expect(
      adminCreateUser(subAdmin.id, {
        email: `denied-${crypto.randomUUID()}@test.local`,
        password: "password123",
        name: "Denied",
        reason: "Should not be allowed.",
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("allows a sub-admin with USER_MANAGEMENT", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "USER_MANAGEMENT" },
    });

    const user = await adminCreateUser(subAdmin.id, {
      email: `granted-${crypto.randomUUID()}@test.local`,
      password: "password123",
      name: "Granted",
      reason: "Sub-admin onboarding.",
    });
    createdUserIds.push(user.id);

    expect(user.createdByAdminId).toBe(subAdmin.id);
  });

  it("rejects an empty reason", async () => {
    const mainAdmin = await getMainAdmin();

    await expect(
      adminCreateUser(mainAdmin.id, {
        email: `noreason-${crypto.randomUUID()}@test.local`,
        password: "password123",
        name: "No Reason",
        reason: "",
      }),
    ).rejects.toThrow();
  });
});
