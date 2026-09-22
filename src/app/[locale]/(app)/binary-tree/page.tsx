import { getTranslations, getLocale } from "next-intl/server";
import { requireMarketerOrRedirect } from "@/lib/page-guard";
import { getMySubtree } from "@/lib/binary-tree";
import {
  getMyLatestBinaryCycle,
  getMyCurrentLegVolumes,
  daysUntilNextSaturday,
  type QualificationFailureReason,
} from "@/lib/binary-cycle";
import { toDisplay } from "@/lib/display";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BinaryTreeView, type ClientSubtreeNode } from "./binary-tree-view";
import { BinaryPanel } from "./binary-panel";
import type { SubtreeNode } from "@/lib/binary-tree";

function toClientSubtreeNode(node: SubtreeNode): ClientSubtreeNode {
  return {
    userId: node.userId,
    name: node.name,
    position: node.position,
    personalBv: toDisplay(node.personalBv),
    children: node.children.map(toClientSubtreeNode),
  };
}

const MAX_DEPTH = 5;

export default async function BinaryTreePage() {
  const t = await getTranslations("BinaryTree");
  const locale = await getLocale();
  const now = new Date();
  const user = await requireMarketerOrRedirect(now);

  const [subtree, latestCycle, currentLegVolumes] = await Promise.all([
    getMySubtree(user.id, MAX_DEPTH),
    getMyLatestBinaryCycle(user.id),
    getMyCurrentLegVolumes(user.id, now),
  ]);

  const daysUntilClose = daysUntilNextSaturday(now);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-10 lg:px-8">
      <div className="space-y-1.5 border-b border-border/60 pb-6">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">{t("pageTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("pageDescription")}</p>
      </div>

      <Card className="border-border/60">
        <CardHeader>
          <CardTitle className="text-base font-medium">{t("cycleHeading")}</CardTitle>
          <CardDescription>{t("cycleDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <BinaryPanel
            cycle={
              latestCycle
                ? {
                    weekStart: latestCycle.weekStart.toISOString(),
                    weekEnd: latestCycle.weekEnd.toISOString(),
                    leftVolume: toDisplay(latestCycle.leftVolume),
                    rightVolume: toDisplay(latestCycle.rightVolume),
                    matchedVolume: toDisplay(latestCycle.matchedVolume),
                    commissionPaid: toDisplay(latestCycle.commissionPaid),
                    carryLeft: toDisplay(latestCycle.carryLeft),
                    carryRight: toDisplay(latestCycle.carryRight),
                    qualified: latestCycle.qualified,
                    // qualificationReason is only ever written by
                    // closeBinaryCycleForUser's own QualificationFailureReason
                    // union — the DB column is a plain nullable string
                    // (no Postgres enum), so this narrows what's already true
                    // by construction rather than validating untrusted input.
                    qualificationReason: latestCycle.qualificationReason as QualificationFailureReason | null,
                  }
                : null
            }
            daysUntilClose={daysUntilClose}
            currentLegVolumes={{
              leftVolume: toDisplay(currentLegVolumes.leftVolume),
              rightVolume: toDisplay(currentLegVolumes.rightVolume),
              weakLeg: currentLegVolumes.weakLeg,
              estimatedCommission: toDisplay(currentLegVolumes.estimatedCommission),
            }}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-semibold">{t("treeHeading")}</h2>
          <p className="text-sm text-muted-foreground">{t("treeDescription")}</p>
        </div>
        <BinaryTreeView subtree={subtree ? toClientSubtreeNode(subtree) : null} locale={locale} />
      </div>
    </div>
  );
}
