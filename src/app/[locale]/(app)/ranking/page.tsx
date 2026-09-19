import { getTranslations } from "next-intl/server";
import { requireMarketerOrRedirect } from "@/lib/page-guard";
import { getRankProgressForUser, listActiveRankLadder } from "@/lib/rank";
import { toDisplay } from "@/lib/display";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RankProgressPanel, type DashboardRankProgress } from "@/components/rank-progress-panel";
import { RankLadder } from "./rank-ladder";

export default async function RankingPage() {
  const t = await getTranslations("Ranking");
  const now = new Date();
  const user = await requireMarketerOrRedirect(now);

  const [rankProgress, ladder] = await Promise.all([
    getRankProgressForUser(user.id, now),
    listActiveRankLadder(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("progressHeading")}</CardTitle>
          <CardDescription>{t("progressDescription")}</CardDescription>
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

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("ladderHeading")}</CardTitle>
          <CardDescription>{t("ladderDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <RankLadder
            ranks={ladder.map((r) => ({
              id: r.id,
              rankName: r.rankName,
              mrvRequired: toDisplay(r.mrvRequired),
              directReferralsRequired: r.directReferralsRequired,
              rewardAmount: toDisplay(r.rewardAmount),
              rewardType: r.rewardType,
              rankOrder: r.rankOrder,
            }))}
            currentRankName={rankProgress.currentRank?.name ?? null}
          />
        </CardContent>
      </Card>
    </div>
  );
}
