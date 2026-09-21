import { TrendingUp } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireSessionOrRedirect } from "@/lib/page-guard";
import { getDailyInterestHistoryA, getTodayInterestCreditA, getWalletOverview } from "@/lib/wallets";
import { listActiveInvestmentsForUser, listInvestmentsForUser } from "@/lib/investments";
import { buildDailyProfitSeries } from "@/lib/daily-profit-series";
import {
  getMyLatestBinaryCycle,
  daysUntilNextSaturday,
  type QualificationFailureReason,
} from "@/lib/binary-cycle";
import { getRankProgressForUser } from "@/lib/rank";
import { toDisplay, toDisplayWithCurrency } from "@/lib/display";
import { WalletCard, TodayProfitFooter } from "@/components/wallet-card";
import { DailyProfitChart } from "@/components/daily-profit-chart";
import { InvestmentsPanel } from "@/components/investments-panel";
import { BinaryPanel, type DashboardBinaryCycle } from "@/components/binary-panel";
import { RankProgressPanel, type DashboardRankProgress } from "@/components/rank-progress-panel";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

const CHART_WINDOW_DAYS = 30;

export default async function DashboardPage() {
  const t = await getTranslations("Dashboard");
  const locale = await getLocale();
  const user = await requireSessionOrRedirect(new Date());
  const now = new Date();

  const [wallets, todayProfitA, investments, activeInvestments, latestBinaryCycle, rankProgress] =
    await Promise.all([
      getWalletOverview(user.id),
      getTodayInterestCreditA(user.id, now),
      listInvestmentsForUser(user.id),
      listActiveInvestmentsForUser(user.id),
      getMyLatestBinaryCycle(user.id),
      getRankProgressForUser(user.id, now),
    ]);

  const daysUntilBinaryClose = daysUntilNextSaturday(now);

  const earliestProfitStart = investments.reduce<Date | null>((earliest, inv) => {
    return earliest === null || inv.profitStartsAt < earliest ? inv.profitStartsAt : earliest;
  }, null);

  const windowStart = new Date(now.getTime() - (CHART_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000);
  const chartStart =
    earliestProfitStart && earliestProfitStart > windowStart ? earliestProfitStart : windowStart;

  const chartData =
    chartStart <= now
      ? buildDailyProfitSeries(await getDailyInterestHistoryA(user.id, chartStart, now), chartStart, now)
      : [];
  // A day-by-day series always has one point per day in the window (even an
  // all-zero one), so `chartData.length > 0` alone can't tell "real accrual
  // history exists" apart from "no investments yet, here's 30 days of
  // nothing" — the latter rendered as a flat, near-invisible zero line
  // instead of an obvious empty state. Check for at least one real credited
  // day instead.
  const hasChartHistory = chartData.some((point) => (point.amount ?? 0) > 0);

  return (
    <div className="dashboard-background mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <WalletCard
          label={t("walletALabel")}
          subLabel={t("walletASubLabel")}
          amount={toDisplayWithCurrency(wallets.A)}
          footer={
            <TodayProfitFooter
              amount={toDisplay(todayProfitA)}
              locale={locale}
              label={t("todayProfitLabel")}
              noneLabel={t("todayProfitNone")}
            />
          }
        />
        <WalletCard
          label={t("walletBLabel")}
          subLabel={t("walletBSubLabel")}
          amount={toDisplayWithCurrency(wallets.B)}
        />
        <WalletCard
          label={t("walletCLabel")}
          subLabel={t("walletCSubLabel")}
          amount={toDisplayWithCurrency(wallets.C)}
        />
        <WalletCard
          label={t("walletSavingLabel")}
          subLabel={t("walletSavingSubLabel")}
          amount={toDisplayWithCurrency(wallets.SAVING)}
        />
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("chartHeading")}</CardTitle>
          <CardDescription>{t("chartDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {hasChartHistory ? (
            <DailyProfitChart
              data={chartData}
              fridayLabel={t("chartFridayTooltip")}
              todayLabel={t("chartTodayTooltip")}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                <TrendingUp className="size-6" />
              </div>
              <p className="max-w-sm text-sm text-muted-foreground">{t("chartEmptyState")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("investmentsHeading")}</CardTitle>
          <CardDescription>{t("investmentsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <InvestmentsPanel investments={activeInvestments} now={now} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("binaryHeading")}</CardTitle>
          <CardDescription>{t("binaryDescription")}</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/binary-tree" />}>
              {t("binaryViewTreeLink")}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <BinaryPanel
            cycle={
              latestBinaryCycle
                ? ({
                    leftVolume: toDisplay(latestBinaryCycle.leftVolume),
                    rightVolume: toDisplay(latestBinaryCycle.rightVolume),
                    carryLeft: toDisplay(latestBinaryCycle.carryLeft),
                    carryRight: toDisplay(latestBinaryCycle.carryRight),
                    qualified: latestBinaryCycle.qualified,
                    // qualificationReason is only ever written by
                    // closeBinaryCycleForUser's own QualificationFailureReason
                    // union — the DB column is a plain nullable string (no
                    // Postgres enum), so this narrows what's already true by
                    // construction rather than validating untrusted input.
                    qualificationReason: latestBinaryCycle.qualificationReason as QualificationFailureReason | null,
                  } satisfies DashboardBinaryCycle)
                : null
            }
            daysUntilClose={daysUntilBinaryClose}
          />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("rankHeading")}</CardTitle>
          <CardDescription>{t("rankDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <RankProgressPanel
            progress={
              {
                currentRankName: rankProgress.currentRank?.name ?? null,
                nextRankName: rankProgress.nextRank?.name ?? null,
                mrvRequired: rankProgress.nextRank ? toDisplay(rankProgress.nextRank.mrvRequired) : null,
                directReferralsRequired: rankProgress.nextRank?.directReferralsRequired ?? null,
                currentMrv: toDisplay(rankProgress.currentMrv),
                currentReferralCount: rankProgress.currentReferralCount,
              } satisfies DashboardRankProgress
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
