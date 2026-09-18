import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { hashPassword, verifyPassword } from "./password";
import { login, changePassword, updateAdminEmail } from "./auth";
import { validateAndTouchSession } from "./session";

const createdUserIds: string[] = [];

async function makeUser(overrides: { suspended?: boolean } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `login-${crypto.randomUUID()}@test.local`,
      passwordHash: await hashPassword("correct-password"),
      name: "Login Test User",
      role: "USER",
      suspendedAt: overrides.suspended ? new Date() : null,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function uniqueIp() {
  return `10.${crypto.randomUUID().slice(0, 8)}`;
}

afterAll(async () => {
  await prisma.securityEvent.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("login", () => {
  it("creates a valid session on correct credentials", async () => {
    const user = await makeUser();
    const now = new Date();

    const result = await login(
      { email: user.email, password: "correct-password" },
      now,
      uniqueIp(),
    );
    if (result.status !== "authenticated") throw new Error("expected immediate session for a user");

    const validated = await validateAndTouchSession(result.token, now);
    expect(validated?.id).toBe(user.id);
  });

  it("rejects a wrong password", async () => {
    const user = await makeUser();
    await expect(
      login({ email: user.email, password: "wrong-password" }, new Date(), uniqueIp()),
    ).rejects.toThrow(/invalid email or password/i);
  });

  it("rejects an unknown email", async () => {
    await expect(
      login(
        { email: `nobody-${crypto.randomUUID()}@test.local`, password: "x" },
        new Date(),
        uniqueIp(),
      ),
    ).rejects.toThrow(/invalid email or password/i);
  });

  it("rejects a suspended account even with the correct password", async () => {
    const user = await makeUser({ suspended: true });
    await expect(
      login({ email: user.email, password: "correct-password" }, new Date(), uniqueIp()),
    ).rejects.toThrow(/invalid email or password/i);
  });
});

describe("changePassword", () => {
  it("changes the password when the current password is correct", async () => {
    const user = await makeUser();
    await changePassword(user.id, { currentPassword: "correct-password", newPassword: "new-password-123" });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(verifyPassword(updated.passwordHash, "new-password-123")).resolves.toBe(true);
    await expect(verifyPassword(updated.passwordHash, "correct-password")).resolves.toBe(false);
  });

  it("rejects an incorrect current password and leaves the password unchanged", async () => {
    const user = await makeUser();
    await expect(
      changePassword(user.id, { currentPassword: "wrong-password", newPassword: "new-password-123" }),
    ).rejects.toThrow(/current password is incorrect/i);

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    await expect(verifyPassword(unchanged.passwordHash, "correct-password")).resolves.toBe(true);
  });

  it("rejects a new password shorter than 8 characters", async () => {
    const user = await makeUser();
    await expect(
      changePassword(user.id, { currentPassword: "correct-password", newPassword: "short" }),
    ).rejects.toThrow();
  });
});

describe("updateAdminEmail", () => {
  it("changes the email when the current password is correct and the new email is free", async () => {
    const user = await makeUser();
    const newEmail = `changed-${crypto.randomUUID()}@test.local`;

    await updateAdminEmail(user.id, { currentPassword: "correct-password", newEmail }, new Date());

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.email).toBe(newEmail);
  });

  it("logs an EMAIL_CHANGED security event under the account's original email", async () => {
    const user = await makeUser();
    const newEmail = `changed-${crypto.randomUUID()}@test.local`;
    const now = new Date();

    await updateAdminEmail(user.id, { currentPassword: "correct-password", newEmail }, now);

    const event = await prisma.securityEvent.findFirst({
      where: { type: "EMAIL_CHANGED", userId: user.id, email: user.email },
    });
    expect(event).not.toBeNull();
    expect(event?.detail).toContain(newEmail);
  });

  it("rejects an incorrect current password and leaves the email unchanged", async () => {
    const user = await makeUser();
    await expect(
      updateAdminEmail(
        user.id,
        { currentPassword: "wrong-password", newEmail: `changed-${crypto.randomUUID()}@test.local` },
        new Date(),
      ),
    ).rejects.toThrow(/current password is incorrect/i);

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unchanged.email).toBe(user.email);
  });

  it("rejects a new email already in use by another account", async () => {
    const user = await makeUser();
    const other = await makeUser();

    await expect(
      updateAdminEmail(user.id, { currentPassword: "correct-password", newEmail: other.email }, new Date()),
    ).rejects.toThrow(/already in use/i);

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unchanged.email).toBe(user.email);
  });

  it("is a no-op (no error, no duplicate security event) when the new email equals the current one", async () => {
    const user = await makeUser();

    await updateAdminEmail(user.id, { currentPassword: "correct-password", newEmail: user.email }, new Date());

    const event = await prisma.securityEvent.findFirst({
      where: { type: "EMAIL_CHANGED", userId: user.id },
    });
    expect(event).toBeNull();
  });
});

describe("login rate limiting and lockout", () => {
  it(
    "locks the account after 5 failed attempts within 15 minutes, per-account",
    async () => {
      const user = await makeUser();
      const t0 = new Date("2026-02-01T00:00:00Z");

      for (let i = 0; i < 5; i++) {
        await expect(
          login({ email: user.email, password: "wrong" }, new Date(t0.getTime() + i * 1000), uniqueIp()),
        ).rejects.toThrow(/invalid email or password/i);
      }

      await expect(
        login(
          { email: user.email, password: "correct-password" },
          new Date(t0.getTime() + 6000),
          uniqueIp(),
        ),
      ).rejects.toThrow(/locked/i);

      const lockEvent = await prisma.securityEvent.findFirst({
        where: { type: "ACCOUNT_LOCKED", email: user.email },
      });
      expect(lockEvent).not.toBeNull();
    },
    15000,
  );

  it(
    "locks per-IP even across different accounts",
    async () => {
      const attackerIp = uniqueIp();
      const t0 = new Date("2026-02-02T00:00:00Z");

      for (let i = 0; i < 5; i++) {
        const user = await makeUser();
        await expect(
          login(
            { email: user.email, password: "wrong" },
            new Date(t0.getTime() + i * 1000),
            attackerIp,
          ),
        ).rejects.toThrow(/invalid email or password/i);
      }

      const freshUser = await makeUser();
      await expect(
        login(
          { email: freshUser.email, password: "correct-password" },
          new Date(t0.getTime() + 6000),
          attackerIp,
        ),
      ).rejects.toThrow(/too many attempts/i);
    },
    15000,
  );

  it("does not lock out a fresh IP/account pair after another account's failures", async () => {
    const user = await makeUser();
    const now = new Date("2026-02-03T00:00:00Z");

    const result = await login(
      { email: user.email, password: "correct-password" },
      now,
      uniqueIp(),
    );
    expect(result.status).toBe("authenticated");
  });
});
