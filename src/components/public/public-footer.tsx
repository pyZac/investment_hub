import { useTranslations } from "next-intl";
import { LogoMark } from "@/components/logo";
import { Link } from "@/i18n/navigation";

export function PublicFooter() {
  const t = useTranslations("Public");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border/60 bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 py-8 text-center lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" dir="ltr">
          <LogoMark />
          <span className="font-heading text-base leading-none font-semibold tracking-[0.1em] text-brand">
            INVESTA
          </span>
        </Link>
        <div className="flex flex-row flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span>{t("footerCopyright", { year })}</span>
          <Link href="/login" className="font-medium text-brand hover:underline">
            {t("navLogin")}
          </Link>
        </div>
      </div>
    </footer>
  );
}
