import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { hashToken } from "./token-hash";

const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

export type PendingAuthPurpose = "TOTP_VERIFICATION" | "TOTP_ENROLLMENT";

/**
 * A short-lived token proving the password check already passed, without
 * granting a full session. Used to bridge password verification and TOTP
 * verification/enrollment — the only two things a pending token authorizes.
 */
export async function createPendingAuth(
  userId: string,
  purpose: PendingAuthPurpose,
  forDate: Date,
) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(forDate.getTime() + PENDING_AUTH_TTL_MS);

  await prisma.pendingAuth.create({
    data: { userId, purpose, tokenHash: hashToken(token), expiresAt },
  });

  return { token, expiresAt };
}

/**
 * Consumes a pending-auth token for the given purpose: validates it exists,
 * hasn't expired, and matches the expected purpose, then deletes it (single
 * use, whether the follow-up check succeeds or not — the caller re-issues a
 * fresh pending token on failure if the flow should continue).
 */
export async function consumePendingAuth(
  token: string,
  purpose: PendingAuthPurpose,
  forDate: Date,
) {
  const tokenHash = hashToken(token);
  const pending = await prisma.pendingAuth.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!pending || pending.purpose !== purpose) {
    return null;
  }

  await prisma.pendingAuth.delete({ where: { id: pending.id } });

  if (pending.expiresAt.getTime() <= forDate.getTime()) {
    return null;
  }

  return pending.user;
}
