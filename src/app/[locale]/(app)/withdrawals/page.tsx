import { getTranslations, getLocale } from "next-intl/server";
import { requireSessionOrRedirect } from "@/lib/page-guard";
import { getWalletBalance } from "@/lib/wallets";
import { withdrawableProfitA, withdrawableC } from "@/lib/withdrawable";
import { listInvestmentsForUser } from "@/lib/investments";
import { listWithdrawalRequestsForUser } from "@/lib/withdrawal-requests";
import { isFriday } from "@/lib/interest-rate";
import { daysUntilNextFriday } from "@/lib/next-friday";
import { toDisplay } from "@/lib/display";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TransferPanel } from "./transfer-panel";
import { CapitalReleasePanel } from "./capital-release-panel";
import { BExitForm } from "./b-exit-form";
import { BExitStatusList } from "./b-exit-status-list";

export default async function WithdrawalsPage() {
  const t = await getTranslations("Withdrawals");
  const locale = await getLocale();
  const user = await requireSessionOrRedirect(new Date());
  const now = new Date();

  const [walletA, walletB, walletC, profitA, freeC, investments, requests] = await Promise.all([
    getWalletBalance(user.id, "A"),
    getWalletBalance(user.id, "B"),
    getWalletBalance(user.id, "C"),
    withdrawableProfitA(user.id),
    withdrawableC(user.id),
    listInvestmentsForUser(user.id),
    listWithdrawalRequestsForUser(user.id),
  ]);

  const friday = isFriday(now);
  const daysUntilFriday = daysUntilNextFriday(now);
  const activeInvestments = investments.filter((investment) => investment.status === "ACTIVE");

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-4 border-b border-border/60 pb-6">
        <div className="space-y-1.5">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="inline-flex items-baseline gap-2 rounded-lg bg-muted/60 px-4 py-2.5">
            <span className="text-sm text-muted-foreground">Wallet A</span>
            <span className="font-heading text-lg font-semibold tabular-nums">{toDisplay(walletA)}</span>
          </div>
          <div className="inline-flex items-baseline gap-2 rounded-lg bg-muted/60 px-4 py-2.5">
            <span className="text-sm text-muted-foreground">Wallet B</span>
            <span className="font-heading text-lg font-semibold tabular-nums">{toDisplay(walletB)}</span>
          </div>
          <div className="inline-flex items-baseline gap-2 rounded-lg bg-muted/60 px-4 py-2.5">
            <span className="text-sm text-muted-foreground">Wallet C</span>
            <span className="font-heading text-lg font-semibold tabular-nums">{toDisplay(walletC)}</span>
          </div>
        </div>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("transfersHeading")}</CardTitle>
          <CardDescription>{t("transfersDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <TransferPanel
            isFriday={friday}
            daysUntilFriday={daysUntilFriday}
            withdrawableA={toDisplay(profitA)}
            withdrawableC={toDisplay(freeC)}
            locale={locale}
          />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("capitalReleaseHeading")}</CardTitle>
          <CardDescription>{t("capitalReleaseDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CapitalReleasePanel
            investments={activeInvestments.map((investment) => ({
              id: investment.id,
              amount: toDisplay(investment.amount),
              capitalUnlocksAt: investment.capitalUnlocksAt.toISOString(),
            }))}
            now={now.toISOString()}
            isFriday={friday}
            daysUntilFriday={daysUntilFriday}
            locale={locale}
          />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("bExitHeading")}</CardTitle>
          <CardDescription>{t("bExitDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <BExitForm isFriday={friday} daysUntilFriday={daysUntilFriday} walletBBalance={toDisplay(walletB)} locale={locale} />
          <BExitStatusList
            requests={requests.map((r) => ({
              id: r.id,
              amount: toDisplay(r.amount),
              status: r.status,
              requestedAt: r.requestedAt.toISOString(),
              decidedAt: r.decidedAt?.toISOString() ?? null,
              adminComment: r.adminComment,
            }))}
            locale={locale}
          />
        </CardContent>
      </Card>
    </div>
  );
}
