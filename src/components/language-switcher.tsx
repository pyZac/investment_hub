"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useParams } from "next/navigation";
import { locales } from "@/i18n/routing";

export function LanguageSwitcher() {
  const t = useTranslations("LanguageSwitcher");
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams();

  return (
    <select
      aria-label={t("en")}
      defaultValue={params.locale as string}
      onChange={(event) => {
        router.replace(
          // @ts-expect-error -- pathname is dynamically typed per route
          { pathname, params },
          { locale: event.target.value },
        );
      }}
    >
      {locales.map((locale) => (
        <option key={locale} value={locale}>
          {t(locale)}
        </option>
      ))}
    </select>
  );
}
