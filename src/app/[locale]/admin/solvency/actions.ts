"use server";

import { requirePermission } from "@/lib/route-guard";
import { getSolvencyOverview } from "@/lib/solvency";
import { toDisplayWithCurrency } from "@/lib/display";

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
        totalCreditIssued: toDisplayWithCurrency(overview.totalCreditIssued),
        totalLiabilities: toDisplayWithCurrency(overview.totalLiabilities),
        liabilitiesBreakdown: {
          walletA: toDisplayWithCurrency(overview.liabilitiesBreakdown.walletA),
          walletB: toDisplayWithCurrency(overview.liabilitiesBreakdown.walletB),
          walletC: toDisplayWithCurrency(overview.liabilitiesBreakdown.walletC),
          walletSaving: toDisplayWithCurrency(overview.liabilitiesBreakdown.walletSaving),
        },
        solvencyRatio: overview.solvencyRatio?.toString() ?? null,
        projectedLiabilities30d: toDisplayWithCurrency(overview.projectedLiabilities30d),
      },
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
