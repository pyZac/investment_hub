"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * `requireSession`/`requireAdmin` (route-guard.ts) throw `AuthError` from
 * every protected Server Component page when the session cookie is missing
 * or expired — there is no middleware-level auth check (middleware.ts only
 * handles locale routing), so an unauthenticated visit to any dashboard page
 * previously surfaced as an unhandled 500 instead of a redirect to /login.
 * `AuthError` itself is a server-only class and can't be imported here (this
 * boundary runs on the client), so it's detected by message text instead.
 */
export default function LocaleError({ error }: { error: Error & { digest?: string } }) {
  const router = useRouter();

  const isAuthError = /not authenticated|account suspended|forbidden/i.test(error.message);

  useEffect(() => {
    if (isAuthError) {
      router.replace("/login");
    }
  }, [isAuthError, router]);

  if (isAuthError) {
    return null;
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">Please try again.</p>
    </div>
  );
}
