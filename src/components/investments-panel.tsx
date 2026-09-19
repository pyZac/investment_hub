import type { Investment, Package } from "@prisma/client";
import { TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { daysUntil } from "@/lib/investments";
import { InvestmentLockCard } from "@/components/investment-lock-card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

type InvestmentWithPackage = Investment & { package: Package };

export async function InvestmentsPanel({
  investments,
  now,
}: {
  investments: InvestmentWithPackage[];
  now: Date;
}) {
  const t = await getTranslations("Dashboard");
  const tInvestments = await getTranslations("Investments");

  if (investments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
          <TrendingUp className="size-6" />
        </div>
        <p className="max-w-sm text-sm text-muted-foreground">
          {t("investmentsEmptyState")}
        </p>
        <Button className="mt-2 cursor-pointer" nativeButton={false} render={<Link href="/packages" />}>
          {tInvestments("browsePackages")}
        </Button>
      </div>
    );
  }

  const labels = {
    profitStartLabel: t("profitStartRingLabel"),
    capitalUnlockLabel: t("capitalUnlockRingLabel"),
    profitAccruingLabel: tInvestments("profitAccruing"),
    capitalUnlockedLabel: tInvestments("capitalUnlocked"),
    profitDaysValue: (days: number) => t("ringDaysValue", { days }),
    capitalDaysValue: (days: number) => t("ringDaysValue", { days }),
    profitSrDescription: (days: number) => tInvestments("profitStartsInDays", { days }),
    capitalSrDescription: (days: number) => tInvestments("capitalUnlocksInDays", { days }),
  };

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {investments.map((investment) => (
        <InvestmentLockCard
          key={investment.id}
          investment={investment}
          now={now}
          profitDaysLeft={daysUntil(investment.profitStartsAt, now)}
          capitalDaysLeft={daysUntil(investment.capitalUnlocksAt, now)}
          labels={labels}
        />
      ))}
    </div>
  );
}
