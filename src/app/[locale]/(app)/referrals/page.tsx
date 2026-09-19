import { headers } from "next/headers";
import QRCode from "qrcode";
import { getTranslations, getLocale } from "next-intl/server";
import { requireMarketerOrRedirect } from "@/lib/page-guard";
import { listReferralsForUser } from "@/lib/users";
import { listDirectCommissionHistoryForUser } from "@/lib/direct-commission";
import { toDisplay } from "@/lib/display";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ReferralCodeCard } from "./referral-code-card";
import { ReferralsList } from "./referrals-list";
import { CommissionHistoryList } from "./commission-history-list";

/**
 * No registration UI page exists yet in this codebase (Phase 10 has only
 * shipped /login so far) — this link's receiving end (a page reading
 * `?ref=`) is not implemented. SCRUM-97 is display-only ("referral link/code
 * display... commission history breakdown"), so the link is built in the
 * shape a future registration page would consume, not wired to a working
 * destination yet.
 */
async function buildReferralLink(locale: string, code: string): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}/${locale}/register?ref=${code}`;
}

export default async function ReferralsPage() {
  const t = await getTranslations("Referrals");
  const locale = await getLocale();
  const user = await requireMarketerOrRedirect(new Date());

  const [referrals, history] = await Promise.all([
    listReferralsForUser(user.id),
    listDirectCommissionHistoryForUser(user.id),
  ]);

  const referralLink = await buildReferralLink(locale, user.id);
  const qrCodeDataUrl = await QRCode.toDataURL(referralLink, {
    margin: 1,
    color: { dark: "#06201f", light: "#f4f5f1" },
  });

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("referralCodeHeading")}</CardTitle>
          <CardDescription>{t("referralCodeDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <ReferralCodeCard code={user.id} link={referralLink} qrCodeDataUrl={qrCodeDataUrl} />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("referralsHeading")}</CardTitle>
          <CardDescription>{t("referralsDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("commissionHistoryHeading")}</CardTitle>
          <CardDescription>{t("commissionHistoryDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CommissionHistoryList
            entries={history.map((h) => ({
              id: h.id,
              wallet: h.wallet as "C" | "SAVING",
              amount: toDisplay(h.amount),
              createdAt: h.createdAt.toISOString(),
            }))}
            locale={locale}
          />
        </CardContent>
      </Card>
    </div>
  );
}
