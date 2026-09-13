import { z } from "zod";
import { prisma } from "./prisma";
import { verifyPassword, hashPassword } from "./password";
import { createSession } from "./session";
import { assertNotLockedOut, recordFailedAttempt, maybeTriggerLockout } from "./rate-limit";
import { createPendingAuth, consumePendingAuth } from "./pending-auth";
import { verifyTotpCode } from "./totp";
import { config } from "./config";

const loginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

const LOGIN_EVENT_TYPES = ["LOGIN_FAILED"] as const;

export type LoginResult =
  | { status: "authenticated"; user: { id: string; email: string; name: string; role: "USER" | "ADMIN" }; token: string; expiresAt: Date }
  | { status: "totp_required"; pendingToken: string }
  | { status: "totp_enrollment_required"; pendingToken: string };

/**
 * Credential check, rate-limited and lockout-protected (5 failures / 15 min,
 * per-account and per-IP). On correct credentials:
 *  - regular users get a session immediately (2FA is optional for them);
 *  - admin/sub-admin accounts with TOTP already enrolled get a pending token
 *    that only authorizes a follow-up verifyTotpAndCreateSession() call —
 *    no session exists yet;
 *  - admin/sub-admin accounts with no TOTP secret get a pending token that
 *    only authorizes enrollment (beginTotpEnrollment/confirmTotpEnrollment).
 * Mandatory 2FA means an admin can never reach a session on password alone —
 * EXCEPT when `config.DISABLE_ADMIN_TOTP` is set, a dev-only escape hatch
 * (see .env) that skips this branch entirely so an admin authenticates like
 * a regular user. Defaults to false (TOTP enforced) everywhere; must be
 * false/unset before Phase 13 deployment.
 */
export async function login(
  input: z.infer<typeof loginInputSchema>,
  forDate: Date,
  ipAddress: string,
): Promise<LoginResult> {
  const data = loginInputSchema.parse(input);

  await assertNotLockedOut([...LOGIN_EVENT_TYPES], data.email, ipAddress, forDate);

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  const valid = user && !user.suspendedAt && (await verifyPassword(user.passwordHash, data.password));

  if (!valid) {
    await recordFailedAttempt("LOGIN_FAILED", data.email, ipAddress, forDate, user?.id);
    await maybeTriggerLockout([...LOGIN_EVENT_TYPES], data.email, forDate, user?.id);
    throw new Error("Invalid email or password.");
  }

  if (user.role === "ADMIN" && !config.DISABLE_ADMIN_TOTP) {
    if (!user.totpSecret) {
      const { token } = await createPendingAuth(user.id, "TOTP_ENROLLMENT", forDate);
      return { status: "totp_enrollment_required", pendingToken: token };
    }
    const { token } = await createPendingAuth(user.id, "TOTP_VERIFICATION", forDate);
    return { status: "totp_required", pendingToken: token };
  }

  const { token, expiresAt } = await createSession(user.id, user.role, forDate);
  return {
    status: "authenticated",
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token,
    expiresAt,
  };
}

const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

/**
 * Self-service password change for an already-authenticated user (invariant
 * #9: caller must pass the requesting session's own userId, never a
 * client-supplied one). Requires the correct current password — same
 * verifyPassword() check as login, no separate rate-limit bucket since this
 * route is already behind requireSession().
 */
export async function changePassword(
  userId: string,
  input: z.infer<typeof changePasswordInputSchema>,
): Promise<void> {
  const data = changePasswordInputSchema.parse(input);

  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const valid = await verifyPassword(user.passwordHash, data.currentPassword);
  if (!valid) {
    throw new Error("Current password is incorrect.");
  }

  const passwordHash = await hashPassword(data.newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

const TOTP_EVENT_TYPES = ["TOTP_FAILED"] as const;

/**
 * Second step of login for an admin who already has TOTP enrolled. Consumes
 * the pending token (single use) and, on a correct code, creates the real
 * session. Wrong codes are rate-limited/lockout-protected the same as
 * password attempts.
 */
export async function verifyTotpAndCreateSession(
  pendingToken: string,
  code: string,
  forDate: Date,
  ipAddress: string,
) {
  const user = await consumePendingAuth(pendingToken, "TOTP_VERIFICATION", forDate);
  if (!user) {
    throw new Error("This login attempt has expired. Please log in again.");
  }

  await assertNotLockedOut([...TOTP_EVENT_TYPES], user.email, ipAddress, forDate);

  if (!user.totpSecret || !verifyTotpCode(user.totpSecret, code)) {
    await recordFailedAttempt("TOTP_FAILED", user.email, ipAddress, forDate, user.id);
    await maybeTriggerLockout([...TOTP_EVENT_TYPES], user.email, forDate, user.id);
    throw new Error("Invalid authentication code.");
  }

  const { token, expiresAt } = await createSession(user.id, user.role, forDate);
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    token,
    expiresAt,
  };
}
