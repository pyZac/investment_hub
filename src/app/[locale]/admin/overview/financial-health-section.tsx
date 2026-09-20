import { getTranslations } from "next-intl/server";
import { Coins, Scale, Percent } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function ratioPercent(ratio: string | null): string | null {
  if (ratio === null) return null;
  return (Number(ratio) * 100).toFixed(2);
}

export async function FinancialHealthSection({
  totalCreditIssued,
  totalLiabilities,
  solvencyRatio,
}: {
  totalCreditIssued: string;
  totalLiabilities: string;
  solvencyRatio: string | null;
}) {
  const t = await getTranslations("AdminOverview");

  const ratioPct = ratioPercent(solvencyRatio);
  const isOverIssued = ratioPct !== null && Number(ratioPct) > 100;
  const isUnderIssued = ratioPct !== null && Number(ratioPct) < 100;

  return (
    <section className="space-y-4">
      <h2 className="font-heading text-xl font-semibold">{t("financialHealthHeading")}</h2>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-row items-center gap-2 text-sm font-medium text-muted-foreground">
              <Coins className="size-4 shrink-0" aria-hidden="true" />
              <span>{t("totalCreditIssuedLabel")}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold tabular-nums" dir="ltr">
              {totalCreditIssued}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-row items-center gap-2 text-sm font-medium text-muted-foreground">
              <Scale className="size-4 shrink-0" aria-hidden="true" />
              <span>{t("totalLiabilitiesLabel")}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-semibold tabular-nums" dir="ltr">
              {totalLiabilities}
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex flex-row items-center gap-2 text-sm font-medium text-muted-foreground">
              <Percent className="size-4 shrink-0" aria-hidden="true" />
              <span>{t("solvencyRatioLabel")}</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {ratioPct === null ? (
              <p className="text-sm text-muted-foreground">{t("ratioUndefined")}</p>
            ) : (
              <div className="flex flex-row items-center gap-3">
                <p className="font-heading text-3xl font-semibold tabular-nums" dir="ltr">
                  {ratioPct}%
                </p>
                <Badge variant={isOverIssued ? "warning" : isUnderIssued ? "success" : "secondary"}>
                  {isOverIssued ? t("ratioOverIssued") : isUnderIssued ? t("ratioUnderIssued") : t("ratioExact")}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
