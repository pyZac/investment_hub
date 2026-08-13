import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import { createPendingAuth, consumePendingAuth } from "./pending-auth";

const createdUserIds: string[] = [];

async function makeUser() {
  const user = await prisma.user.create({
    data: {
      email: `pending-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Pending Auth Test User",
      role: "ADMIN",
    },
  });
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.pendingAuth.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("createPendingAuth / consumePendingAuth", () => {
  it("consumes a valid token and returns its owning user", async () => {
    const user = await makeUser();
    const now = new Date();
    const { token } = await createPendingAuth(user.id, "TOTP_VERIFICATION", now);

    const consumed = await consumePendingAuth(token, "TOTP_VERIFICATION", now);
    expect(consumed?.id).toBe(user.id);
  });

  it("is single-use — a second consume of the same token fails", async () => {
    const user = await makeUser();
    const now = new Date();
    const { token } = await createPendingAuth(user.id, "TOTP_VERIFICATION", now);

    await consumePendingAuth(token, "TOTP_VERIFICATION", now);
    const second = await consumePendingAuth(token, "TOTP_VERIFICATION", now);
    expect(second).toBeNull();
  });

  it("rejects a token consumed for the wrong purpose", async () => {
    const user = await makeUser();
    const now = new Date();
    const { token } = await createPendingAuth(user.id, "TOTP_VERIFICATION", now);

    const result = await consumePendingAuth(token, "TOTP_ENROLLMENT", now);
    expect(result).toBeNull();
  });

  it("rejects an expired token", async () => {
    const user = await makeUser();
    const t0 = new Date("2026-05-01T00:00:00Z");
    const { token } = await createPendingAuth(user.id, "TOTP_VERIFICATION", t0);

    const wayLater = new Date(t0.getTime() + 60 * 60 * 1000);
    const result = await consumePendingAuth(token, "TOTP_VERIFICATION", wayLater);
    expect(result).toBeNull();
  });

  it("rejects an unknown token", async () => {
    const result = await consumePendingAuth("not-a-real-token", "TOTP_VERIFICATION", new Date());
    expect(result).toBeNull();
  });
});
