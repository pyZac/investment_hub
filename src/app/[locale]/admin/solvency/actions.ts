"use server";

import { requirePermission } from "@/lib/route-guard";
import { getSolvencyOverview } from "@/lib/solvency";

export type SolvencyErrorKey = "errorForbidden" | "errorGeneric";

function mapError(err: unknown): SolvencyErrorKey {
  if (err instanceof Error && /forbidden/i.test(err.message)) return "errorForbidden";
  return "errorGeneric";
}

export type SolvencyOverviewRow = {
  totalCreditIssued: string;
  totalLiabilities: string;
  liabilitiesBreakdown: {
    walletA: string;
    walletB: string;
    walletC: string;
    walletSaving: string;
  };
  solvencyRatio: string | null;
  projectedLiabilities30d: string;
};

export type SolvencyOverviewResult =
  | { ok: true; overview: SolvencyOverviewRow }
  | { ok: false; errorKey: SolvencyErrorKey };

export async function getSolvencyOverviewAction(): Promise<SolvencyOverviewResult> {
  try {
    const actor = await requirePermission("SOLVENCY_VIEW", new Date());
    const overview = await getSolvencyOverview(actor.id, new Date());
    return {
      ok: true,
      overview: {
        totalCreditIssued: overview.totalCreditIssued.toString(),
        totalLiabilities: overview.totalLiabilities.toString(),
        liabilitiesBreakdown: {
          walletA: overview.liabilitiesBreakdown.walletA.toString(),
          walletB: overview.liabilitiesBreakdown.walletB.toString(),
          walletC: overview.liabilitiesBreakdown.walletC.toString(),
          walletSaving: overview.liabilitiesBreakdown.walletSaving.toString(),
        },
        solvencyRatio: overview.solvencyRatio?.toString() ?? null,
        projectedLiabilities30d: overview.projectedLiabilities30d.toString(),
      },
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
