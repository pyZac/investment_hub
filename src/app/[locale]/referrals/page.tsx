import { getTranslations, getLocale } from "next-intl/server";
import { requireSession } from "@/lib/route-guard";
import { listReferralsForUser } from "@/lib/users";
import { listDirectCommissionHistoryForUser } from "@/lib/direct-commission";
import { toDisplay } from "@/lib/display";
import { ReferralCodeCard } from "./referral-code-card";
import { ReferralsList } from "./referrals-list";
import { CommissionHistoryList } from "./commission-history-list";

export default async function ReferralsPage() {
  const t = await getTranslations("Referrals");
  const locale = await getLocale();
  const user = await requireSession(new Date());

  const [referrals, history] = await Promise.all([
    listReferralsForUser(user.id),
    listDirectCommissionHistoryForUser(user.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10 lg:px-8">
      <div className="space-y-10">
        <div className="space-y-1.5 border-b border-border/60 pb-6">
          <h1 className="text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
        </div>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{t("referralCodeHeading")}</h2>
            <p className="text-sm text-muted-foreground">{t("referralCodeDescription")}</p>
          </div>
          <ReferralCodeCard code={user.id} />
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{t("referralsHeading")}</h2>
            <p className="text-sm text-muted-foreground">{t("referralsDescription")}</p>
          </div>
          <ReferralsList
            referrals={referrals.map((r) => ({
              id: r.id,
              name: r.name,
              email: r.email,
              createdAt: r.createdAt.toISOString(),
              suspendedAt: r.suspendedAt?.toISOString() ?? null,
              hasPurchased: r.hasPurchased,
            }))}
            locale={locale}
          />
        </section>

        <section className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">{t("commissionHistoryHeading")}</h2>
            <p className="text-sm text-muted-foreground">{t("commissionHistoryDescription")}</p>
          </div>
          <CommissionHistoryList
            entries={history.map((h) => ({
              id: h.id,
              wallet: h.wallet as "C" | "SAVING",
              amount: toDisplay(h.amount),
              createdAt: h.createdAt.toISOString(),
            }))}
            locale={locale}
          />
        </section>
      </div>
    </div>
  );
}
