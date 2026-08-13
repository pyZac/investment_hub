import { prisma } from "./prisma";
import type { SecurityEventType } from "@prisma/client";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export type { SecurityEventType };

/**
 * Records a failed attempt as a visible security event. Always keyed by
 * email (even if the email doesn't resolve to a real account, so attempts
 * against unknown emails are still tracked) and by IP.
 */
export async function recordFailedAttempt(
  type: SecurityEventType,
  email: string,
  ipAddress: string,
  forDate: Date,
  userId?: string,
) {
  await prisma.securityEvent.create({
    data: { type, email, ipAddress, userId, createdAt: forDate },
  });
}

async function recentFailureCount(
  types: SecurityEventType[],
  where: { email?: string; ipAddress?: string },
  forDate: Date,
) {
  const since = new Date(forDate.getTime() - WINDOW_MS);
  return prisma.securityEvent.count({
    where: {
      type: { in: types },
      createdAt: { gt: since },
      ...where,
    },
  });
}

/**
 * Throws if either the account (by email) or the source IP has hit the
 * failed-attempt threshold within the rate-limit window, or is within an
 * active lockout window following a threshold breach. Checked before every
 * attempt on login, password reset, and security-question endpoints.
 */
export async function assertNotLockedOut(
  types: SecurityEventType[],
  email: string,
  ipAddress: string,
  forDate: Date,
) {
  const lockoutSince = new Date(forDate.getTime() - LOCKOUT_MS);
  const activeLockout = await prisma.securityEvent.findFirst({
    where: {
      type: "ACCOUNT_LOCKED",
      email,
      createdAt: { gt: lockoutSince },
    },
    orderBy: { createdAt: "desc" },
  });

  if (activeLockout) {
    throw new Error("Account temporarily locked due to repeated failed attempts. Try again later.");
  }

  const [byEmail, byIp] = await Promise.all([
    recentFailureCount(types, { email }, forDate),
    recentFailureCount(types, { ipAddress }, forDate),
  ]);

  if (byEmail >= MAX_ATTEMPTS || byIp >= MAX_ATTEMPTS) {
    throw new Error("Too many attempts. Try again later.");
  }
}

/**
 * Called after recording a failed attempt. If the account has now reached
 * the threshold within the window, logs a visible ACCOUNT_LOCKED security
 * event (a lockout is never a silent failure).
 */
export async function maybeTriggerLockout(
  types: SecurityEventType[],
  email: string,
  forDate: Date,
  userId?: string,
) {
  const count = await recentFailureCount(types, { email }, forDate);
  if (count >= MAX_ATTEMPTS) {
    await prisma.securityEvent.create({
      data: {
        type: "ACCOUNT_LOCKED",
        email,
        userId,
        detail: `${count} failed attempts within ${WINDOW_MS / 60000} minutes.`,
        createdAt: forDate,
      },
    });
  }
}
