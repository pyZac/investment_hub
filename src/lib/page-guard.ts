import { redirect } from "next/navigation";
import { requireSession } from "./route-guard";
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
