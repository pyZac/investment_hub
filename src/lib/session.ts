import { randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { hashToken } from "./token-hash";

export const SESSION_COOKIE_NAME = "session";

const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const USER_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;

export function idleTimeoutForRole(role: "USER" | "ADMIN"): number {
  return role === "ADMIN" ? ADMIN_IDLE_TIMEOUT_MS : USER_IDLE_TIMEOUT_MS;
}

export const sessionCookieOptions = {
  httpOnly: true,
  // Secure cookies are refused/dropped by browsers over plain HTTP, which is
  // how this app is served in local dev (http://localhost:3000) — hardcoding
  // true here silently broke session persistence in dev. Production is
  // always served over HTTPS, so this stays Secure there.
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/",
};

/**
 * Creates a session for a user. Returns the raw token (goes in the cookie —
 * never stored) and the row's expiry. Idle timeout length depends on role,
 * per the phase brief (shorter for admin/sub-admin than regular users).
 */
export async function createSession(userId: string, role: "USER" | "ADMIN", forDate: Date) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(forDate.getTime() + idleTimeoutForRole(role));

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      lastActiveAt: forDate,
    },
  });

  return { token, expiresAt };
}

/**
 * Validates a session token, enforcing idle timeout. On success, "touches"
 * the session — pushes expiresAt forward from forDate by the role's idle
 * timeout — and returns the session's user. Expired or unknown tokens return
 * null; the expired row is deleted so it can't be replayed.
 */
export async function validateAndTouchSession(token: string, forDate: Date) {
  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) {
    return null;
  }

  if (session.expiresAt.getTime() <= forDate.getTime()) {
    await prisma.session.delete({ where: { id: session.id } });
    return null;
  }

  const newExpiresAt = new Date(forDate.getTime() + idleTimeoutForRole(session.user.role));

  await prisma.session.update({
    where: { id: session.id },
    data: { lastActiveAt: forDate, expiresAt: newExpiresAt },
  });

  return session.user;
}

export async function destroySession(token: string) {
  const tokenHash = hashToken(token);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

export async function destroyAllSessionsForUser(userId: string) {
  await prisma.session.deleteMany({ where: { userId } });
}
