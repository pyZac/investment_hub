import { afterAll, describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { prisma } from "./prisma";
import { hashPassword } from "./password";
import { login, verifyTotpAndCreateSession } from "./auth";
import { beginTotpEnrollment, confirmTotpEnrollment, removeTotp } from "./totp-enrollment";
import { validateAndTouchSession } from "./session";

const createdUserIds: string[] = [];

async function makeAdmin(overrides: { totpSecret?: string } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `2fa-${crypto.randomUUID()}@test.local`,
      passwordHash: await hashPassword("correct-password"),
      name: "2FA Test Admin",
      role: "ADMIN",
      totpSecret: overrides.totpSecret,
      totpEnrolledAt: overrides.totpSecret ? new Date() : null,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

function codeFor(secret: string) {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.generate();
}

function uniqueIp() {
  return `10.${crypto.randomUUID().slice(0, 8)}`;
}

afterAll(async () => {
  await prisma.securityEvent.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.pendingAuth.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("login for admins without TOTP enrolled", () => {
  it("returns totp_enrollment_required instead of a session", async () => {
    const admin = await makeAdmin();
    const result = await login(
      { email: admin.email, password: "correct-password" },
      new Date(),
      uniqueIp(),
    );
    expect(result.status).toBe("totp_enrollment_required");
  });
});

describe("login for admins with TOTP enrolled", () => {
  it("returns totp_required instead of a session", async () => {
    const admin = await makeAdmin({ totpSecret: "JBSWY3DPEHPK3PXP" });
    const result = await login(
      { email: admin.email, password: "correct-password" },
      new Date(),
      uniqueIp(),
    );
    expect(result.status).toBe("totp_required");
  });
});

describe("TOTP enrollment flow", () => {
  it("full flow: enroll -> confirm -> secret persisted -> session created -> event logged", async () => {
    const admin = await makeAdmin();
    const now = new Date();

    const loginResult = await login(
      { email: admin.email, password: "correct-password" },
      now,
      uniqueIp(),
    );
    if (loginResult.status !== "totp_enrollment_required") throw new Error("expected enrollment step");

    const { secret, otpauthUri, pendingToken } = await beginTotpEnrollment(
      loginResult.pendingToken,
      now,
    );
    expect(otpauthUri).toContain(secret);

    const { token } = await confirmTotpEnrollment(pendingToken, secret, codeFor(secret), now);

    const validated = await validateAndTouchSession(token, now);
    expect(validated?.id).toBe(admin.id);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(updated.totpSecret).toBe(secret);
    expect(updated.totpEnrolledAt).not.toBeNull();

    const event = await prisma.securityEvent.findFirst({
      where: { type: "TOTP_ENROLLED", userId: admin.id },
    });
    expect(event).not.toBeNull();
  });

  it("rejects confirmation with a wrong code and does not persist the secret", async () => {
    const admin = await makeAdmin();
    const now = new Date();

    const loginResult = await login(
      { email: admin.email, password: "correct-password" },
      now,
      uniqueIp(),
    );
    if (loginResult.status !== "totp_enrollment_required") throw new Error("expected enrollment step");

    const { secret, pendingToken } = await beginTotpEnrollment(loginResult.pendingToken, now);

    await expect(
      confirmTotpEnrollment(pendingToken, secret, "000000", now),
    ).rejects.toThrow(/invalid authentication code/i);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(updated.totpSecret).toBeNull();
  });

  it("a second login attempt after enrolling now requires TOTP, not re-enrollment", async () => {
    const admin = await makeAdmin();
    const now = new Date();

    const first = await login({ email: admin.email, password: "correct-password" }, now, uniqueIp());
    if (first.status !== "totp_enrollment_required") throw new Error("expected enrollment step");
    const { secret, pendingToken } = await beginTotpEnrollment(first.pendingToken, now);
    await confirmTotpEnrollment(pendingToken, secret, codeFor(secret), now);

    const second = await login(
      { email: admin.email, password: "correct-password" },
      new Date(now.getTime() + 1000),
      uniqueIp(),
    );
    expect(second.status).toBe("totp_required");
  });
});

describe("verifyTotpAndCreateSession", () => {
  it("creates a session on a correct code", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const admin = await makeAdmin({ totpSecret: secret });
    const now = new Date();

    const loginResult = await login(
      { email: admin.email, password: "correct-password" },
      now,
      uniqueIp(),
    );
    if (loginResult.status !== "totp_required") throw new Error("expected totp_required");

    const { token } = await verifyTotpAndCreateSession(
      loginResult.pendingToken,
      codeFor(secret),
      now,
      uniqueIp(),
    );

    const validated = await validateAndTouchSession(token, now);
    expect(validated?.id).toBe(admin.id);
  });

  it("rejects an incorrect code", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const admin = await makeAdmin({ totpSecret: secret });
    const now = new Date();

    const loginResult = await login(
      { email: admin.email, password: "correct-password" },
      now,
      uniqueIp(),
    );
    if (loginResult.status !== "totp_required") throw new Error("expected totp_required");

    await expect(
      verifyTotpAndCreateSession(loginResult.pendingToken, "000000", now, uniqueIp()),
    ).rejects.toThrow(/invalid authentication code/i);
  });

  it("rejects reusing an already-consumed pending token", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const admin = await makeAdmin({ totpSecret: secret });
    const now = new Date();

    const loginResult = await login(
      { email: admin.email, password: "correct-password" },
      now,
      uniqueIp(),
    );
    if (loginResult.status !== "totp_required") throw new Error("expected totp_required");

    await verifyTotpAndCreateSession(loginResult.pendingToken, codeFor(secret), now, uniqueIp());

    await expect(
      verifyTotpAndCreateSession(loginResult.pendingToken, codeFor(secret), now, uniqueIp()),
    ).rejects.toThrow(/expired/i);
  });
});

describe("removeTotp", () => {
  it("removes the secret on a correct code and logs a security event", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const admin = await makeAdmin({ totpSecret: secret });

    await removeTotp(admin.id, codeFor(secret), new Date());

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(updated.totpSecret).toBeNull();
    expect(updated.totpEnrolledAt).toBeNull();

    const event = await prisma.securityEvent.findFirst({
      where: { type: "TOTP_REMOVED", userId: admin.id },
    });
    expect(event).not.toBeNull();
  });

  it("rejects an incorrect code and leaves TOTP intact", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const admin = await makeAdmin({ totpSecret: secret });

    await expect(removeTotp(admin.id, "000000", new Date())).rejects.toThrow(
      /invalid authentication code/i,
    );

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(updated.totpSecret).toBe(secret);
  });
});
