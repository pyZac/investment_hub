import { TrendingUp } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, toDisplay, toDisplayWithCurrency } from "@/lib/display";
import type { InvestmentProfitBreakdownRow } from "@/lib/investments";

/**
 * Per-investment profit breakdown row for the dashboard — today's and total
 * profit for ONE active investment, as a plain display row (no new charts,
 * per the ticket's own "keep it simple" instruction). Server Component,
 * matching `InvestmentsPanel`'s shape — no client interactivity needed.
 *
 * Package name + amount are shown together (`{packageName} — {amount}
 * package`) rather than either alone: `Package.name` is an admin-chosen
 * free-text label, not necessarily the dollar figure itself, so both pieces
 * of information from the ticket's own wording ("package name/amount") are
 * real, independent facts worth showing.
 */
export async function ProfitBreakdownPanel({
  rows,
  locale,
}: {
  rows: InvestmentProfitBreakdownRow[];
  locale: string;
}) {
  const t = await getTranslations("Dashboard");

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
          <TrendingUp className="size-6" aria-hidden="true" />
        </div>
        <p className="max-w-sm text-sm text-muted-foreground">{t("profitBreakdownEmptyState")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <Card key={row.investmentId} className="border-border/60 shadow-sm">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {t("profitBreakdownPackageAmount", {
                  packageName: row.packageName,
                  amount: toDisplayWithCurrency(row.amount),
                })}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("profitBreakdownPurchasedOn", { date: formatDate(row.purchasedAt, locale) })}
              </p>
            </div>

            <div className="flex flex-row items-center gap-6">
              <div className="space-y-0.5 text-end">
                <p className="text-xs text-muted-foreground">{t("profitBreakdownTodayLabel")}</p>
                <p dir="ltr" className="font-heading text-sm font-semibold tabular-nums text-success">
                  ${toDisplay(row.todayProfit)}
                </p>
              </div>
              <div className="space-y-0.5 text-end">
                <p className="text-xs text-muted-foreground">{t("profitBreakdownTotalLabel")}</p>
                <p dir="ltr" className="font-heading text-sm font-semibold tabular-nums">
                  ${toDisplay(row.totalProfit)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
