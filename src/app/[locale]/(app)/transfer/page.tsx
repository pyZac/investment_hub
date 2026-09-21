import { getTranslations, getLocale } from "next-intl/server";
import { requireSessionOrRedirect } from "@/lib/page-guard";
import { getWalletBalance } from "@/lib/wallets";
import { toDisplay, toDisplayWithCurrency } from "@/lib/display";
import { config } from "@/lib/config";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TransferForm } from "./transfer-form";

export default async function TransferPage() {
  const t = await getTranslations("Transfer");
  const locale = await getLocale();
  const user = await requireSessionOrRedirect(new Date());

  const walletB = await getWalletBalance(user.id, "B");

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-4 border-b border-border/60 pb-6">
        <div className="space-y-1.5">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="inline-flex items-baseline gap-2 rounded-lg bg-muted/60 px-4 py-2.5">
            <span className="text-sm text-muted-foreground">Wallet B</span>
            <span dir="ltr" className="font-heading text-lg font-semibold tabular-nums">
              {toDisplayWithCurrency(walletB)}
            </span>
          </div>
        </div>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("sectionHeading")}</CardTitle>
          <CardDescription>{t("sectionDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-md">
            <TransferForm walletBBalance={toDisplay(walletB)} minimumTransfer={config.MIN_WITHDRAWAL} locale={locale} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
