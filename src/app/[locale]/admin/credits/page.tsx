import { getTranslations, getLocale } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { listRecentCreditIssuances } from "@/lib/admin-credit";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { toDisplayWithCurrency } from "@/lib/display";
import { CreditForm } from "./credit-form";
import { RecentCreditsList } from "./recent-credits-list";

export default async function AdminCreditsPage() {
  const t = await getTranslations("AdminCredits");
  const locale = await getLocale();
  const actor = await requirePermissionOrRedirect("CREDIT_ISSUANCE", new Date());

  const recentCredits = await listRecentCreditIssuances(actor.id);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("formHeading")}</CardTitle>
          <CardDescription>{t("formDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CreditForm locale={locale} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("recentHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <RecentCreditsList
            initialCredits={recentCredits.map((c) => ({
              id: c.id,
              targetUserName: c.targetUserName,
              targetUserEmail: c.targetUserEmail,
              adminName: c.adminName,
              amount: toDisplayWithCurrency(c.amount ?? 0),
              reason: c.reason,
              createdAt: c.createdAt.toISOString(),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
