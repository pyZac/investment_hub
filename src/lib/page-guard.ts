import { redirect } from "next/navigation";
import type { AdminPermission } from "@prisma/client";
import { requireSession, requireMainAdmin, requirePermission } from "./route-guard";
import { AuthError } from "./route-guard";

/**
 * `requireSession` throws `AuthError` when there's no valid session —
 * correct for API routes (caught and turned into a JSON 401), but a Server
 * Component page has no error-JSON path: an uncaught throw during SSR
 * renders a raw 500, not a redirect (`error.tsx`'s client boundary only
 * catches errors from client-side navigation, never the initial SSR
 * response for a hard/direct visit). Every protected page should call this
 * instead of `requireSession` directly so an unauthenticated visit lands on
 * /login instead of a 500.
 *
 * Lives outside route-guard.ts (not merged into requireSession itself)
 * because `redirect()` throws Next's internal NEXT_REDIRECT signal, which
 * only works inside a real request context — route-guard.ts's own unit
 * tests call requireSession() directly under plain Vitest with no such
 * context, so coupling requireSession to next/navigation would break them.
 */
export async function requireSessionOrRedirect(forDate: Date) {
  try {
    return await requireSession(forDate);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect("/login");
    }
    throw err;
  }
}

/**
 * Same rationale as requireSessionOrRedirect, for admin account management
 * pages (sub-admin creation/permissions/deactivation) — this surface is
 * gated on isMainAdmin specifically, not any grantable permission
 * (invariant #8). A 401 (no session) redirects to /login same as any
 * protected page; a 403 (authenticated but not the main admin — including a
 * sub-admin with every other permission granted) redirects to /dashboard
 * rather than rendering a raw 500, since this is an expected outcome for
 * most authenticated admins, not an exceptional error.
 */
export async function requireMainAdminOrRedirect(forDate: Date) {
  try {
    return await requireMainAdmin(forDate);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect(err.status === 401 ? "/login" : "/dashboard");
    }
    throw err;
  }
}

/**
 * Same rationale as requireMainAdminOrRedirect, for any admin page gated by
 * a specific grantable AdminPermission (the 11-value catalog) rather than
 * main-admin status. A sub-admin without the required grant gets a 403,
 * redirected to /dashboard rather than a raw 500 — the phase 11 doc's own
 * constraint ("a sub-admin with only WITHDRAWAL_APPROVAL sees that screen
 * and nothing else") means hitting an unauthorized admin page directly is
 * an expected, not exceptional, outcome.
 */
export async function requirePermissionOrRedirect(permission: AdminPermission, forDate: Date) {
  try {
    return await requirePermission(permission, forDate);
  } catch (err) {
    if (err instanceof AuthError) {
      redirect(err.status === 401 ? "/login" : "/dashboard");
    }
    throw err;
  }
}

/**
 * Gates the marketer-only user-facing pages (Binary Tree, Referrals,
 * Ranking) — a regular (non-marketer) user hitting one of these URLs
 * directly is redirected to /dashboard rather than seeing the page, same
 * "hidden nav tab implies blocked page" rule requirePermissionOrRedirect
 * already applies on the admin side. No session at all still redirects to
 * /login first, same as every other *OrRedirect helper here.
 */
export async function requireMarketerOrRedirect(forDate: Date) {
  const user = await requireSessionOrRedirect(forDate);
  if (!user.isMarketer) {
    redirect("/dashboard");
  }
  return user;
}
