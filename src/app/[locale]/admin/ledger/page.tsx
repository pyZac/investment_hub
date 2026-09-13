import { getTranslations } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LedgerExplorer } from "./ledger-explorer";

export default async function AdminLedgerPage() {
  const t = await getTranslations("AdminLedger");
  await requirePermissionOrRedirect("LEDGER_VIEW", new Date());

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("listHeading")}</CardTitle>
          <CardDescription>{t("listDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <LedgerExplorer />
        </CardContent>
      </Card>
    </div>
  );
}
