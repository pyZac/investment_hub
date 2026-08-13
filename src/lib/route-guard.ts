import { cookies } from "next/headers";
import type { AdminPermission } from "@prisma/client";
import { prisma } from "./prisma";
import { SESSION_COOKIE_NAME, validateAndTouchSession, destroySession } from "./session";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Resolves the current request's session from the cookie jar. Re-checks
 * suspension on every call — a session created before an account was
 * suspended must not remain a live backdoor, so a suspended user's token is
 * destroyed on the request that discovers it, not left to linger.
 *
 * `tokenOverride` exists only for tests: `next/headers`'s cookies() requires
 * a real Next.js request context, so real callers never pass it and always
 * resolve the token from the request's own cookie jar.
 */
export async function requireSession(forDate: Date, tokenOverride?: string) {
  const token = tokenOverride ?? (await cookies()).get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    throw new AuthError("Not authenticated.", 401);
  }

  const user = await validateAndTouchSession(token, forDate);
  if (!user) {
    throw new AuthError("Not authenticated.", 401);
  }

  if (user.suspendedAt) {
    await destroySession(token);
    throw new AuthError("Account suspended.", 401);
  }

  return user;
}

/**
 * Requires an authenticated admin or sub-admin — no specific permission
 * check, just role. Use requirePermission() for anything gated by the
 * grantable catalog; this is only for admin-panel-wide checks (if any).
 */
export async function requireAdmin(forDate: Date, tokenOverride?: string) {
  const user = await requireSession(forDate, tokenOverride);
  if (user.role !== "ADMIN") {
    throw new AuthError("Forbidden.", 403);
  }
  return user;
}

/**
 * Requires the specific admin_permission_grants entry for the given
 * permission — never a blanket "is this user an admin" check. The main
 * admin (is_main_admin = true) short-circuits to allowed for every
 * permission, per invariant #8; sub-admins need the explicit grant. Admin
 * account management itself is not in the grantable catalog and is
 * main-admin-only by construction — callers for that surface should use
 * requireMainAdmin(), not this function with an invented permission value.
 */
export async function requirePermission(
  permission: AdminPermission,
  forDate: Date,
  tokenOverride?: string,
) {
  const user = await requireAdmin(forDate, tokenOverride);

  if (user.isMainAdmin) {
    return user;
  }

  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: user.id, permission } },
  });

  if (!grant) {
    throw new AuthError(`Forbidden: missing ${permission} permission.`, 403);
  }

  return user;
}

/**
 * Requires the main admin specifically — for admin account management
 * (creating/editing/deactivating sub-admins, changing their permissions),
 * which is exclusively main-admin-only and not part of the grantable
 * catalog at all.
 */
export async function requireMainAdmin(forDate: Date, tokenOverride?: string) {
  const user = await requireAdmin(forDate, tokenOverride);
  if (!user.isMainAdmin) {
    throw new AuthError("Forbidden: main admin only.", 403);
  }
  return user;
}
