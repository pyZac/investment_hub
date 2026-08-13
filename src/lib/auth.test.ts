import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { hashPassword } from "./password";
import { login } from "./auth";
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
