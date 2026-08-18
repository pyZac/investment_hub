import { getTranslations, getLocale } from "next-intl/server";
import { requireSession } from "@/lib/route-guard";
import { getWalletBalance } from "@/lib/wallets";
import { withdrawableProfitA, withdrawableC } from "@/lib/withdrawable";
import { listInvestmentsForUser } from "@/lib/investments";
import { listWithdrawalRequestsForUser } from "@/lib/withdrawal-requests";
import { isFriday } from "@/lib/interest-rate";
import { daysUntilNextFriday } from "@/lib/next-friday";
import { toDisplay } from "@/lib/display";
import { TransferPanel } from "./transfer-panel";
import { CapitalReleasePanel } from "./capital-release-panel";
import { BExitForm } from "./b-exit-form";
import { BExitStatusList } from "./b-exit-status-list";

export default async function WithdrawalsPage() {
  const t = await getTranslations("Withdrawals");
  const locale = await getLocale();
  const user = await requireSession(new Date());
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
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
      <div className="space-y-10">
        <div className="space-y-4 border-b border-border/60 pb-6">
          <div className="space-y-1.5">
            <h1 className="text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="inline-flex items-baseline gap-2 rounded-lg bg-muted/60 px-4 py-2.5">
              <span className="text-sm text-muted-foreground">Wallet A</span>
              <span className="text-lg font-semibold tabular-nums">{toDisplay(walletA)}</span>
            </div>
            <div className="inline-flex items-baseline gap-2 rounded-lg bg-muted/60 px-4 py-2.5">
              <span className="text-sm text-muted-foreground">Wallet B</span>
              <span className="text-lg font-semibold tabular-nums">{toDisplay(walletB)}</span>
            </div>
            <div className="inline-flex items-baseline gap-2 rounded-lg bg-muted/60 px-4 py-2.5">
              <span className="text-sm text-muted-foreground">Wallet C</span>
              <span className="text-lg font-semibold tabular-nums">{toDisplay(walletC)}</span>
            </div>
          </div>
        </div>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{t("transfersHeading")}</h2>
            <p className="text-sm text-muted-foreground">{t("transfersDescription")}</p>
          </div>
          <TransferPanel
            isFriday={friday}
            daysUntilFriday={daysUntilFriday}
            withdrawableA={toDisplay(profitA)}
            withdrawableC={toDisplay(freeC)}
            locale={locale}
          />
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{t("capitalReleaseHeading")}</h2>
            <p className="text-sm text-muted-foreground">{t("capitalReleaseDescription")}</p>
          </div>
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
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{t("bExitHeading")}</h2>
            <p className="text-sm text-muted-foreground">{t("bExitDescription")}</p>
          </div>
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
        </section>
      </div>
    </div>
  );
}
