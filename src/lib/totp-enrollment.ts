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
 * Session-scoped TOTP re-enrollment: for an already-authenticated admin who
 * wants to switch to a new authenticator device/app, not the login-flow
 * enrollment above (which is tied to a login pending-token and only reachable
 * when no secret exists yet). Generates a new secret but does NOT persist it
 * or touch the existing one until confirmReenrollment verifies a real code —
 * same "prove you can generate a valid code before it's trusted" bar as
 * first-time enrollment. No pending-auth token involved since the caller is
 * already a verified session (invariant #9: the route wrapping this passes
 * the session's own userId, never a client-supplied one).
 */
export function beginTotpReenrollment(accountEmail: string) {
  const secret = generateTotpSecret();
  return {
    secret,
    otpauthUri: totpOtpauthUri(secret, accountEmail),
  };
}

/**
 * Confirms re-enrollment: verifies a real code against the new (not yet
 * persisted) secret, then overwrites the account's existing totpSecret in
 * one step — the old secret stops working the instant this succeeds, so
 * there's never a window where both the old and new secret are valid.
 * Logged as TOTP_ENROLLED, same event type as first-time enrollment (this is
 * a re-enrollment, not a distinct lifecycle event — the audit trail cares
 * that a new secret took effect, not whether one existed before).
 */
export async function confirmTotpReenrollment(userId: string, secret: string, code: string, forDate: Date) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

  if (!verifyTotpCode(secret, code)) {
    throw new Error("Invalid authentication code.");
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { totpSecret: secret, totpEnrolledAt: forDate },
    }),
    prisma.securityEvent.create({
      data: { type: "TOTP_ENROLLED", userId, email: user.email, detail: "Re-enrollment", createdAt: forDate },
    }),
  ]);
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
