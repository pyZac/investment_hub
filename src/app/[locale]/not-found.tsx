import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/**
 * Without this file, an unmatched route (e.g. visiting /admin with no
 * page.tsx at that exact segment, or an invalid locale triggering this
 * layout's own notFound() call) falls through to Next's built-in
 * not-found renderer under the bare root layout (src/app/layout.tsx),
 * which intentionally has no <html>/<body> — those only exist in this
 * [locale] segment's own layout.tsx. That produced "Missing <html> and
 * <body> tags in the root layout" instead of a real page. Scoping
 * not-found.tsx to this segment makes it render inside LocaleLayout, the
 * same reasoning already applied to this directory's own error.tsx.
 */
export default async function LocaleNotFound() {
  const t = await getTranslations("NotFound");

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("description")}</p>
      <Link href="/dashboard" className="text-sm font-medium text-primary underline underline-offset-4">
        {t("backLink")}
      </Link>
    </div>
  );
}
