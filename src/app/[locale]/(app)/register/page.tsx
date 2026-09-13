import { permanentRedirect } from "next/navigation";

/**
 * Public self-registration is closed — Phase 11 moves all user creation into
 * the admin panel. The backend registration logic (registerWithSponsor,
 * registerAsRoot in src/lib/users.ts) is untouched and still covered by its
 * own tests; only this public-facing route is closed. A 301 (not the
 * default 307 from next-intl's own redirect() helper) signals this is a
 * permanent closure, not a temporary maintenance redirect — matters for any
 * search engine or bookmarked referral link that hit /register directly.
 */
export default async function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/login`);
}
