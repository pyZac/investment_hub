import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { verifyPassword } from "./password";
import {
  setSecurityQuestions,
  resetPasswordViaSecurityQuestions,
  adminResetPassword,
  CannotResetMainAdminPasswordError,
} from "./security-questions";

const createdUserIds: string[] = [];

const sampleQuestions = [
  { question: "First pet's name?", answer: "Fluffy" },
  { question: "Mother's maiden name?", answer: "Smith" },
  { question: "First school?", answer: "Oakwood" },
];

async function makeUser() {
  const user = await prisma.user.create({
    data: {
      email: `user-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Test User",
      role: "USER",
    },
  });
  createdUserIds.push(user.id);
  return user;
}

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
  return prisma.user.findFirstOrThrow({ where: { isMainAdmin: true } });
}

function uniqueIp() {
  return `10.${crypto.randomUUID().slice(0, 8)}`;
}

afterAll(async () => {
  await prisma.adminAction.deleteMany({
    where: { OR: [{ targetUserId: { in: createdUserIds } }, { adminId: { in: createdUserIds } }] },
  });
  await prisma.adminPermissionGrant.deleteMany({ where: { adminUserId: { in: createdUserIds } } });
  await prisma.securityQuestion.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.securityEvent.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("setSecurityQuestions", () => {
  it("stores exactly 3 hashed questions", async () => {
    const user = await makeUser();
    const rows = await setSecurityQuestions(user.id, sampleQuestions);

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.answerHash).not.toBe("Fluffy");
      expect(row.answerHash).not.toBe("fluffy");
    }
  });

  it("rejects fewer than 3 questions", async () => {
    const user = await makeUser();
    await expect(setSecurityQuestions(user.id, sampleQuestions.slice(0, 2))).rejects.toThrow();
  });

  it("replaces existing questions rather than appending", async () => {
    const user = await makeUser();
    await setSecurityQuestions(user.id, sampleQuestions);
    await setSecurityQuestions(user.id, [
      { question: "Q1?", answer: "a1" },
      { question: "Q2?", answer: "a2" },
      { question: "Q3?", answer: "a3" },
    ]);

    const rows = await prisma.securityQuestion.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.question).sort()).toEqual(["Q1?", "Q2?", "Q3?"]);
  });
});

describe("resetPasswordViaSecurityQuestions", () => {
  it("resets the password when all answers are correct", async () => {
    const user = await makeUser();
    await setSecurityQuestions(user.id, sampleQuestions);

    await resetPasswordViaSecurityQuestions(
      {
        email: user.email,
        answers: ["Fluffy", "Smith", "Oakwood"],
        newPassword: "newpassword123",
      },
      new Date(),
      uniqueIp(),
    );

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(verifyPassword(updated.passwordHash, "newpassword123")).resolves.toBe(true);
  });

  it("is case/whitespace insensitive on answers", async () => {
    const user = await makeUser();
    await setSecurityQuestions(user.id, sampleQuestions);

    await resetPasswordViaSecurityQuestions(
      {
        email: user.email,
        answers: ["  FLUFFY ", "smith", "OakWood"],
        newPassword: "newpassword123",
      },
      new Date(),
      uniqueIp(),
    );

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(verifyPassword(updated.passwordHash, "newpassword123")).resolves.toBe(true);
  });

  it("rejects when any single answer is wrong", async () => {
    const user = await makeUser();
    await setSecurityQuestions(user.id, sampleQuestions);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

    await expect(
      resetPasswordViaSecurityQuestions(
        {
          email: user.email,
          answers: ["Fluffy", "Smith", "wrong-school"],
          newPassword: "newpassword123",
        },
        new Date(),
        uniqueIp(),
      ),
    ).rejects.toThrow(/invalid/i);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it("rejects an unknown email without leaking existence", async () => {
    await expect(
      resetPasswordViaSecurityQuestions(
        {
          email: `nobody-${crypto.randomUUID()}@test.local`,
          answers: ["a", "b", "c"],
          newPassword: "newpassword123",
        },
        new Date(),
        uniqueIp(),
      ),
    ).rejects.toThrow(/invalid email or answers/i);
  });

  it("rejects a user with no security questions set", async () => {
    const user = await makeUser();
    await expect(
      resetPasswordViaSecurityQuestions(
        {
          email: user.email,
          answers: ["a", "b", "c"],
          newPassword: "newpassword123",
        },
        new Date(),
        uniqueIp(),
      ),
    ).rejects.toThrow(/invalid email or answers/i);
  });

  it(
    "locks the account after 5 failed answer attempts within 15 minutes",
    async () => {
      const user = await makeUser();
      await setSecurityQuestions(user.id, sampleQuestions);
      const t0 = new Date("2026-03-01T00:00:00Z");

      for (let i = 0; i < 5; i++) {
        await expect(
          resetPasswordViaSecurityQuestions(
            {
              email: user.email,
              answers: ["wrong", "wrong", "wrong"],
              newPassword: "newpassword123",
            },
            new Date(t0.getTime() + i * 1000),
            uniqueIp(),
          ),
        ).rejects.toThrow(/invalid/i);
      }

      await expect(
        resetPasswordViaSecurityQuestions(
          {
            email: user.email,
            answers: ["Fluffy", "Smith", "Oakwood"],
            newPassword: "newpassword123",
          },
          new Date(t0.getTime() + 6000),
          uniqueIp(),
        ),
      ).rejects.toThrow(/locked/i);

      const lockEvent = await prisma.securityEvent.findFirst({
        where: { type: "ACCOUNT_LOCKED", email: user.email },
      });
      expect(lockEvent).not.toBeNull();
    },
    20000,
  );
});

describe("adminResetPassword", () => {
  it("main admin can reset a user's password and it logs to admin_actions", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();

    await adminResetPassword(mainAdmin.id, user.id, {
      newPassword: "resetbyadmin123",
      reason: "User locked out, verified identity by phone.",
    });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(verifyPassword(updated.passwordHash, "resetbyadmin123")).resolves.toBe(true);

    const action = await prisma.adminAction.findFirst({
      where: { targetUserId: user.id, actionType: "PASSWORD_RESET" },
    });
    expect(action).not.toBeNull();
    expect(action?.adminId).toBe(mainAdmin.id);
    expect(action?.reason).toMatch(/locked out/);
  });

  it("rejects a sub-admin without USER_MANAGEMENT", async () => {
    const subAdmin = await makeAdmin();
    const user = await makeUser();

    await expect(
      adminResetPassword(subAdmin.id, user.id, {
        newPassword: "resetbyadmin123",
        reason: "Should not be allowed.",
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("allows a sub-admin with USER_MANAGEMENT", async () => {
    const subAdmin = await makeAdmin();
    await prisma.adminPermissionGrant.create({
      data: { adminUserId: subAdmin.id, permission: "USER_MANAGEMENT" },
    });
    const user = await makeUser();

    await adminResetPassword(subAdmin.id, user.id, {
      newPassword: "resetbyadmin123",
      reason: "Sub-admin reset.",
    });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(verifyPassword(updated.passwordHash, "resetbyadmin123")).resolves.toBe(true);
  });

  it("rejects an empty reason", async () => {
    const mainAdmin = await getMainAdmin();
    const user = await makeUser();

    await expect(
      adminResetPassword(mainAdmin.id, user.id, {
        newPassword: "resetbyadmin123",
        reason: "",
      }),
    ).rejects.toThrow();
  });

  it("rejects targeting the main admin's own password", async () => {
    const mainAdmin = await getMainAdmin();
    const originalHash = mainAdmin.passwordHash;

    await expect(
      adminResetPassword(mainAdmin.id, mainAdmin.id, {
        newPassword: "shouldnotapply123",
        reason: "Attempting to reset main admin.",
      }),
    ).rejects.toThrow(CannotResetMainAdminPasswordError);

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: mainAdmin.id } });
    expect(unchanged.passwordHash).toBe(originalHash);
  });
});
