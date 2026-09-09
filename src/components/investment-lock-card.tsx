import type { Investment, Package } from "@prisma/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { CountdownRing } from "@/components/countdown-ring";
import { toDisplay } from "@/lib/display";

type InvestmentWithPackage = Investment & { package: Package };

export function InvestmentLockCard({
  investment,
  now,
  profitDaysLeft,
  capitalDaysLeft,
  labels,
}: {
  investment: InvestmentWithPackage;
  now: Date;
  profitDaysLeft: number;
  capitalDaysLeft: number;
  labels: {
    profitStartLabel: string;
    capitalUnlockLabel: string;
    profitAccruingLabel: string;
    capitalUnlockedLabel: string;
    profitDaysValue: (days: number) => string;
    capitalDaysValue: (days: number) => string;
    profitSrDescription: (days: number) => string;
    capitalSrDescription: (days: number) => string;
  };
}) {
  const profitTotalMs = investment.profitStartsAt.getTime() - investment.purchasedAt.getTime();
  const profitElapsedMs = now.getTime() - investment.purchasedAt.getTime();
  const profitProgress = profitTotalMs > 0 ? profitElapsedMs / profitTotalMs : 1;
  const profitComplete = profitDaysLeft === 0;

  const capitalTotalMs = investment.capitalUnlocksAt.getTime() - investment.purchasedAt.getTime();
  const capitalElapsedMs = now.getTime() - investment.purchasedAt.getTime();
  const capitalProgress = capitalTotalMs > 0 ? capitalElapsedMs / capitalTotalMs : 1;
  const capitalComplete = capitalDaysLeft === 0;

  return (
    <Card className="border-border/60 shadow-sm transition-shadow hover:shadow-md hover:shadow-black/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{investment.package.name}</CardTitle>
        <p className="font-heading text-xl font-semibold tabular-nums">
          {toDisplay(investment.amount)}
        </p>
      </CardHeader>
      <CardContent className="flex items-center justify-center gap-8 pt-2">
        <CountdownRing
          progress={profitProgress}
          variant={profitComplete ? "complete" : "active"}
          label={profitComplete ? "✓" : labels.profitDaysValue(profitDaysLeft)}
          sublabel={labels.profitStartLabel}
          srDescription={
            profitComplete
              ? labels.profitAccruingLabel
              : labels.profitSrDescription(profitDaysLeft)
          }
        />
        <CountdownRing
          progress={capitalProgress}
          variant={capitalComplete ? "complete" : "active"}
          label={capitalComplete ? "✓" : labels.capitalDaysValue(capitalDaysLeft)}
          sublabel={labels.capitalUnlockLabel}
          srDescription={
            capitalComplete
              ? labels.capitalUnlockedLabel
              : labels.capitalSrDescription(capitalDaysLeft)
          }
        />
      </CardContent>
    </Card>
  );
}
