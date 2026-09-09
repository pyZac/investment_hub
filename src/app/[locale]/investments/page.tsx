import { getTranslations, getLocale } from "next-intl/server";
import { requireSessionOrRedirect } from "@/lib/page-guard";
import { listInvestmentsForUser } from "@/lib/investments";
import { InvestmentList } from "./investment-list";

export default async function InvestmentsPage() {
  const t = await getTranslations("Investments");
  const locale = await getLocale();
  const user = await requireSessionOrRedirect(new Date());

  const investments = await listInvestmentsForUser(user.id);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
      <div className="space-y-8">
        <div className="space-y-1.5 border-b border-border/60 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>

        <InvestmentList investments={investments} locale={locale} now={new Date()} />
      </div>
    </div>
  );
}
