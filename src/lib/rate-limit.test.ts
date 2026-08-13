import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { assertNotLockedOut, recordFailedAttempt, maybeTriggerLockout } from "./rate-limit";

const createdEmails: string[] = [];

function uniqueEmail() {
  const email = `ratelimit-${crypto.randomUUID()}@test.local`;
  createdEmails.push(email);
  return email;
}

// UUID-derived, so collisions across concurrent test files sharing the same
// dev DB are effectively impossible (unlike a small numeric random range).
function uniqueIp() {
  return `10.${crypto.randomUUID().slice(0, 8)}`;
}

afterAll(async () => {
  await prisma.securityEvent.deleteMany({ where: { email: { in: createdEmails } } });
  await prisma.$disconnect();
});

describe("assertNotLockedOut / recordFailedAttempt / maybeTriggerLockout", () => {
  it("allows attempts under the threshold", async () => {
    const email = uniqueEmail();
    const ip = uniqueIp();
    const t0 = new Date("2026-04-01T00:00:00Z");

    for (let i = 0; i < 4; i++) {
      const at = new Date(t0.getTime() + i * 1000);
      await assertNotLockedOut(["LOGIN_FAILED"], email, ip, at);
      await recordFailedAttempt("LOGIN_FAILED", email, ip, at);
      await maybeTriggerLockout(["LOGIN_FAILED"], email, at);
    }

    await expect(
      assertNotLockedOut(["LOGIN_FAILED"], email, ip, new Date(t0.getTime() + 5000)),
    ).resolves.toBeUndefined();
  });

  it("blocks the 6th attempt within the window after 5 failures", async () => {
    const email = uniqueEmail();
    const ip = uniqueIp();
    const t0 = new Date("2026-04-02T00:00:00Z");

    for (let i = 0; i < 5; i++) {
      const at = new Date(t0.getTime() + i * 1000);
      await recordFailedAttempt("LOGIN_FAILED", email, ip, at);
    }

    await expect(
      assertNotLockedOut(["LOGIN_FAILED"], email, ip, new Date(t0.getTime() + 6000)),
    ).rejects.toThrow(/too many attempts/i);
  });

  it("does not count attempts outside the 15-minute window", async () => {
    const email = uniqueEmail();
    const ip = uniqueIp();
    const t0 = new Date("2026-04-03T00:00:00Z");

    for (let i = 0; i < 5; i++) {
      await recordFailedAttempt("LOGIN_FAILED", email, ip, new Date(t0.getTime() + i * 1000));
    }

    const wellOutsideWindow = new Date(t0.getTime() + 16 * 60 * 1000);
    await expect(
      assertNotLockedOut(["LOGIN_FAILED"], email, ip, wellOutsideWindow),
    ).resolves.toBeUndefined();
  });

  it("maybeTriggerLockout logs ACCOUNT_LOCKED only once the threshold is hit", async () => {
    const email = uniqueEmail();
    const t0 = new Date("2026-04-04T00:00:00Z");

    for (let i = 0; i < 4; i++) {
      const at = new Date(t0.getTime() + i * 1000);
      await recordFailedAttempt("LOGIN_FAILED", email, uniqueIp(), at);
      await maybeTriggerLockout(["LOGIN_FAILED"], email, at);
    }
    expect(
      await prisma.securityEvent.count({ where: { type: "ACCOUNT_LOCKED", email } }),
    ).toBe(0);

    const fifthAt = new Date(t0.getTime() + 5000);
    await recordFailedAttempt("LOGIN_FAILED", email, uniqueIp(), fifthAt);
    await maybeTriggerLockout(["LOGIN_FAILED"], email, fifthAt);

    expect(
      await prisma.securityEvent.count({ where: { type: "ACCOUNT_LOCKED", email } }),
    ).toBe(1);
  });

  it("an active lockout blocks further attempts even before 5 new failures accrue", async () => {
    const email = uniqueEmail();
    const t0 = new Date("2026-04-05T00:00:00Z");

    await prisma.securityEvent.create({
      data: { type: "ACCOUNT_LOCKED", email, createdAt: t0 },
    });

    await expect(
      assertNotLockedOut(["LOGIN_FAILED"], email, uniqueIp(), new Date(t0.getTime() + 1000)),
    ).rejects.toThrow(/locked/i);
  });

  it("lockout expires after its own window", async () => {
    const email = uniqueEmail();
    const t0 = new Date("2026-04-06T00:00:00Z");

    await prisma.securityEvent.create({
      data: { type: "ACCOUNT_LOCKED", email, createdAt: t0 },
    });

    const afterLockoutWindow = new Date(t0.getTime() + 16 * 60 * 1000);
    await expect(
      assertNotLockedOut(["LOGIN_FAILED"], email, uniqueIp(), afterLockoutWindow),
    ).resolves.toBeUndefined();
  });
});
