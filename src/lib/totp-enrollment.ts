import { prisma } from "./prisma";
import { generateTotpSecret, totpOtpauthUri, verifyTotpCode } from "./totp";
import { consumePendingAuth, createPendingAuth } from "./pending-auth";
import { createSession } from "./session";

/**
 * Starts TOTP enrollment for an admin/sub-admin with no secret yet, using
 * the pending token issued by login() when it detected no TOTP was set up.
 * Generates a new secret (not yet persisted) and returns it plus the
 * otpauth:// URI for the QR code — the secret only gets written to the user
 * row once confirmTotpEnrollment verifies a real code from the app.
 */
export async function beginTotpEnrollment(pendingToken: string, forDate: Date) {
  const user = await consumePendingAuth(pendingToken, "TOTP_ENROLLMENT", forDate);
  if (!user) {
    throw new Error("This enrollment attempt has expired. Please log in again.");
  }

  const secret = generateTotpSecret();
  const { token: nextPendingToken } = await createPendingAuth(user.id, "TOTP_ENROLLMENT", forDate);

  return {
    secret,
    otpauthUri: totpOtpauthUri(secret, user.email),
    pendingToken: nextPendingToken,
  };
}

/**
 * Confirms enrollment: the caller must prove the secret was correctly
 * scanned by producing a valid code before it's persisted. On success,
 * TOTP is now mandatory for this account going forward, and a session is
 * created immediately (enrollment doubles as the first login).
 */
export async function confirmTotpEnrollment(
  pendingToken: string,
  secret: string,
  code: string,
  forDate: Date,
) {
  const user = await consumePendingAuth(pendingToken, "TOTP_ENROLLMENT", forDate);
  if (!user) {
    throw new Error("This enrollment attempt has expired. Please log in again.");
  }

  if (!verifyTotpCode(secret, code)) {
    throw new Error("Invalid authentication code.");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { totpSecret: secret, totpEnrolledAt: forDate },
    }),
    prisma.securityEvent.create({
      data: { type: "TOTP_ENROLLED", userId: user.id, email: user.email, createdAt: forDate },
    }),
  ]);

  const { token, expiresAt } = await createSession(user.id, user.role, forDate);
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token,
    expiresAt,
  };
}

/**
 * Removes TOTP from an account. Requires the current code as proof of
 * possession — an admin can't be locked out by someone else disabling their
 * 2FA without the device. Logged as a security event either way (removal is
 * always visible, matching enrollment).
 */
export async function removeTotp(userId: string, code: string, forDate: Date) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.totpSecret) {
    throw new Error("TOTP is not enrolled for this account.");
  }

  if (!verifyTotpCode(user.totpSecret, code)) {
    throw new Error("Invalid authentication code.");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { totpSecret: null, totpEnrolledAt: null },
    }),
    prisma.securityEvent.create({
      data: { type: "TOTP_REMOVED", userId, email: user.email, createdAt: forDate },
    }),
  ]);
}
