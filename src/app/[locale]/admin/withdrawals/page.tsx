import { getTranslations, getLocale } from "next-intl/server";
import { requirePermissionOrRedirect } from "@/lib/page-guard";
import { listPendingWithdrawalRequests, listDecidedWithdrawalRequests } from "@/lib/withdrawal-requests";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PendingQueue } from "./pending-queue";
import { DecisionHistory } from "./decision-history";

export default async function AdminWithdrawalsPage() {
  const t = await getTranslations("AdminWithdrawals");
  const locale = await getLocale();
  const actor = await requirePermissionOrRedirect("WITHDRAWAL_APPROVAL", new Date());

  const [pending, decided] = await Promise.all([
    listPendingWithdrawalRequests(actor.id),
    listDecidedWithdrawalRequests(actor.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("queueHeading")}</CardTitle>
          <CardDescription>{t("queueDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <PendingQueue
            initialRequests={pending.map((r) => ({
              id: r.id,
              userName: r.userName,
              userEmail: r.userEmail,
              amount: r.amount.toString(),
              requestedAt: r.requestedAt.toISOString(),
              walletBBalance: r.walletBBalance.toString(),
            }))}
            locale={locale}
          />
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("historyHeading")}</CardTitle>
        </CardHeader>
        <CardContent>
          <DecisionHistory
            initialRequests={decided.map((r) => ({
              id: r.id,
              userName: r.userName,
              userEmail: r.userEmail,
              amount: r.amount.toString(),
              status: r.status as "APPROVED" | "REJECTED",
              requestedAt: r.requestedAt.toISOString(),
              decidedAt: r.decidedAt?.toISOString() ?? null,
              decidedByAdminName: r.decidedByAdminName,
              adminComment: r.adminComment,
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
