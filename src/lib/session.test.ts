import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./prisma";
import {
  createSession,
  validateAndTouchSession,
  destroySession,
  destroyAllSessionsForUser,
  idleTimeoutForRole,
} from "./session";

const createdUserIds: string[] = [];

async function makeUser(role: "USER" | "ADMIN" = "USER") {
  const user = await prisma.user.create({
    data: {
      email: `session-${crypto.randomUUID()}@test.local`,
      passwordHash: "x",
      name: "Session Test User",
      role,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

afterAll(async () => {
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("idleTimeoutForRole", () => {
  it("admin timeout is shorter than user timeout", () => {
    expect(idleTimeoutForRole("ADMIN")).toBeLessThan(idleTimeoutForRole("USER"));
  });

  it("admin timeout is ~30 minutes", () => {
    expect(idleTimeoutForRole("ADMIN")).toBe(30 * 60 * 1000);
  });
});

describe("createSession / validateAndTouchSession", () => {
  it("validates a freshly created session and returns the owning user", async () => {
    const user = await makeUser();
    const now = new Date("2026-01-01T00:00:00Z");
    const { token } = await createSession(user.id, user.role, now);

    const validated = await validateAndTouchSession(token, now);
    expect(validated?.id).toBe(user.id);
  });

  it("returns null for an unknown token", async () => {
    const result = await validateAndTouchSession("not-a-real-token", new Date());
    expect(result).toBeNull();
  });

  it("expires a user session after its idle timeout", async () => {
    const user = await makeUser("USER");
    const now = new Date("2026-01-01T00:00:00Z");
    const { token } = await createSession(user.id, user.role, now);

    const justAfterExpiry = new Date(now.getTime() + 4 * 60 * 60 * 1000 + 1);
    const result = await validateAndTouchSession(token, justAfterExpiry);
    expect(result).toBeNull();
  });

  it("expires an admin session sooner than a user session", async () => {
    const admin = await makeUser("ADMIN");
    const now = new Date("2026-01-01T00:00:00Z");
    const { token } = await createSession(admin.id, admin.role, now);

    const after31Minutes = new Date(now.getTime() + 31 * 60 * 1000);
    const result = await validateAndTouchSession(token, after31Minutes);
    expect(result).toBeNull();
  });

  it("touching a session pushes its expiry forward (idle timeout resets on activity)", async () => {
    const user = await makeUser("USER");
    const t0 = new Date("2026-01-01T00:00:00Z");
    const { token } = await createSession(user.id, user.role, t0);

    const t1 = new Date(t0.getTime() + 3 * 60 * 60 * 1000);
    await validateAndTouchSession(token, t1);

    const t2 = new Date(t1.getTime() + 3 * 60 * 60 * 1000);
    const result = await validateAndTouchSession(token, t2);
    expect(result?.id).toBe(user.id);
  });

  it("deletes the row once a session has expired (no replay)", async () => {
    const user = await makeUser();
    const now = new Date("2026-01-01T00:00:00Z");
    const { token } = await createSession(user.id, user.role, now);

    const wayAfterExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await validateAndTouchSession(token, wayAfterExpiry);

    const count = await prisma.session.count({ where: { userId: user.id } });
    expect(count).toBe(0);
  });
});

describe("destroySession / destroyAllSessionsForUser", () => {
  it("destroySession invalidates the token", async () => {
    const user = await makeUser();
    const now = new Date();
    const { token } = await createSession(user.id, user.role, now);

    await destroySession(token);

    const result = await validateAndTouchSession(token, now);
    expect(result).toBeNull();
  });

  it("destroyAllSessionsForUser removes every session for that user", async () => {
    const user = await makeUser();
    const now = new Date();
    const s1 = await createSession(user.id, user.role, now);
    const s2 = await createSession(user.id, user.role, now);

    await destroyAllSessionsForUser(user.id);

    expect(await validateAndTouchSession(s1.token, now)).toBeNull();
    expect(await validateAndTouchSession(s2.token, now)).toBeNull();
  });
});
