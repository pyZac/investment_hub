import type { Investment, Package } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { TrendingUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { toDisplay, formatDate } from "@/lib/display";
import { daysUntil } from "@/lib/investments";

type InvestmentWithPackage = Investment & { package: Package };

export async function InvestmentList({
  investments,
  locale,
  now,
}: {
  investments: InvestmentWithPackage[];
  locale: string;
  now: Date;
}) {
  const t = await getTranslations("Investments");

  if (investments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20 text-center">
        <TrendingUp className="size-10 text-muted-foreground/60" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-base font-medium">{t("emptyStateTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("emptyStateDescription")}</p>
        </div>
        <Button className="mt-2 cursor-pointer" render={<Link href="/packages" />}>
          {t("browsePackages")}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {investments.map((investment) => {
        const profitDaysLeft = daysUntil(investment.profitStartsAt, now);
        const capitalDaysLeft = daysUntil(investment.capitalUnlocksAt, now);

        return (
          <Card
            key={investment.id}
            className="flex flex-col justify-between border-border/60 shadow-sm transition-shadow hover:shadow-md"
          >
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
              <CardTitle className="text-base font-medium">{investment.package.name}</CardTitle>
              <Badge variant={investment.status === "ACTIVE" ? "default" : "secondary"}>
                {investment.status === "ACTIVE" ? t("statusActive") : t("statusCapitalReleased")}
              </Badge>
            </CardHeader>

            <CardContent className="flex-1 space-y-3">
              <p className="text-2xl font-bold tabular-nums">{toDisplay(investment.amount)}</p>
              <p className="text-xs text-muted-foreground">
                {t("purchasedOn")}: {formatDate(investment.purchasedAt, locale)}
              </p>
            </CardContent>

            <CardFooter className="flex flex-col items-stretch gap-2 border-t border-border/60 bg-muted/30 pt-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("profitStartsLabel")}</span>
                <span className="font-medium tabular-nums">
                  {profitDaysLeft > 0
                    ? t("profitStartsInDays", { days: profitDaysLeft })
                    : t("profitAccruing")}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground">{t("capitalUnlocksLabel")}</span>
                <span className="font-medium tabular-nums">
                  {capitalDaysLeft > 0
                    ? t("capitalUnlocksInDays", { days: capitalDaysLeft })
                    : t("capitalUnlocked")}
                </span>
              </div>
            </CardFooter>
          </Card>
        );
      })}
    </div>
  );
}
