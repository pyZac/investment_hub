"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/route-guard";
import {
  editRankConfig,
  createRankConfig,
  listRankConfigs,
  listRankConfigHistory,
  RankAlreadyAchievedError,
  RankOrderTooLowError,
} from "@/lib/rank";

export type RankActionErrorKey =
  | "errorMrvInvalid"
  | "errorReferralsInvalid"
  | "errorRewardInvalid"
  | "errorRankNameRequired"
  | "errorAlreadyAchieved"
  | "errorOrderTooLow"
  | "errorForbidden"
  | "errorGeneric";

function mapError(err: unknown): RankActionErrorKey {
  if (err instanceof RankAlreadyAchievedError) return "errorAlreadyAchieved";
  if (err instanceof RankOrderTooLowError) return "errorOrderTooLow";
  if (err instanceof Error && /forbidden/i.test(err.message)) return "errorForbidden";
  return "errorGeneric";
}

export type RankActionResult = { ok: true } | { ok: false; errorKey: RankActionErrorKey };

/**
 * Calls requirePermission("RANK_CONFIG", ...) first — the real server-side
 * enforcement point (invariant #8), independent of rank.ts's own inline
 * re-check. The "already achieved" refusal happens inside editRankConfig
 * itself (server-side, not just a UI-disabled button) — a direct API call
 * against an achieved rank is rejected the same as a UI submission.
 */
export async function editRankConfigAction(
  rankName: string,
  mrvRequired: string,
  directReferralsRequired: string,
  rewardAmount: string,
  locale: string,
): Promise<RankActionResult> {
  if (!rankName) {
    return { ok: false, errorKey: "errorRankNameRequired" };
  }
  const parsedMrv = Number(mrvRequired);
  if (!mrvRequired || Number.isNaN(parsedMrv) || parsedMrv <= 0) {
    return { ok: false, errorKey: "errorMrvInvalid" };
  }
  const parsedReferrals = Number(directReferralsRequired);
  if (!directReferralsRequired || !Number.isInteger(parsedReferrals) || parsedReferrals <= 0) {
    return { ok: false, errorKey: "errorReferralsInvalid" };
  }
  const parsedReward = Number(rewardAmount);
  if (!rewardAmount || Number.isNaN(parsedReward) || parsedReward <= 0) {
    return { ok: false, errorKey: "errorRewardInvalid" };
  }

  try {
    const actor = await requirePermission("RANK_CONFIG", new Date());
    await editRankConfig(actor.id, {
      rankName,
      mrvRequired,
      directReferralsRequired: parsedReferrals,
      rewardAmount,
      forDate: new Date(),
    });
    revalidatePath(`/${locale}/admin/rank-config`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

/**
 * `rankOrder` is intentionally NOT a parameter here — createRankConfig
 * auto-computes it as 1 + the current highest active rank's order when
 * omitted, which is what makes "new ranks can only be added above the top"
 * structural rather than admin-typed (SCRUM-110). There is no path in this
 * admin panel for specifying rankOrder directly.
 */
export async function createRankConfigAction(
  rankName: string,
  mrvRequired: string,
  directReferralsRequired: string,
  rewardAmount: string,
  rewardType: "CASH" | "CASH_OR_TRIP",
  locale: string,
): Promise<RankActionResult> {
  if (!rankName.trim()) {
    return { ok: false, errorKey: "errorRankNameRequired" };
  }
  const parsedMrv = Number(mrvRequired);
  if (!mrvRequired || Number.isNaN(parsedMrv) || parsedMrv <= 0) {
    return { ok: false, errorKey: "errorMrvInvalid" };
  }
  const parsedReferrals = Number(directReferralsRequired);
  if (!directReferralsRequired || !Number.isInteger(parsedReferrals) || parsedReferrals <= 0) {
    return { ok: false, errorKey: "errorReferralsInvalid" };
  }
  const parsedReward = Number(rewardAmount);
  if (!rewardAmount || Number.isNaN(parsedReward) || parsedReward <= 0) {
    return { ok: false, errorKey: "errorRewardInvalid" };
  }

  try {
    const actor = await requirePermission("RANK_CONFIG", new Date());
    await createRankConfig(actor.id, {
      rankName: rankName.trim(),
      mrvRequired,
      directReferralsRequired: parsedReferrals,
      rewardAmount,
      rewardType,
      forDate: new Date(),
    });
    revalidatePath(`/${locale}/admin/rank-config`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type RankConfigRow = {
  id: string;
  rankName: string;
  mrvRequired: string;
  directReferralsRequired: number;
  rewardAmount: string;
  rewardType: "CASH" | "CASH_OR_TRIP";
  rankOrder: number;
  effectiveFrom: string;
  achievedByAnyUser: boolean;
  setByAdminName: string | null;
};

export type RankConfigListResult = { ok: true; ranks: RankConfigRow[] } | { ok: false; errorKey: RankActionErrorKey };

export async function listRankConfigsAction(): Promise<RankConfigListResult> {
  try {
    const actor = await requirePermission("RANK_CONFIG", new Date());
    const ranks = await listRankConfigs(actor.id);
    return {
      ok: true,
      ranks: ranks.map((r) => ({
        id: r.id,
        rankName: r.rankName,
        mrvRequired: r.mrvRequired.toString(),
        directReferralsRequired: r.directReferralsRequired,
        rewardAmount: r.rewardAmount.toString(),
        rewardType: r.rewardType,
        rankOrder: r.rankOrder,
        effectiveFrom: r.effectiveFrom.toISOString(),
        achievedByAnyUser: r.achievedByAnyUser,
        setByAdminName: r.setByAdminName,
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type RankConfigHistoryRow = {
  id: string;
  rankName: string;
  mrvRequired: string;
  directReferralsRequired: number;
  rewardAmount: string;
  rewardType: "CASH" | "CASH_OR_TRIP";
  rankOrder: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  setByAdminName: string | null;
  createdAt: string;
};

export type RankConfigHistoryResult =
  | { ok: true; history: RankConfigHistoryRow[] }
  | { ok: false; errorKey: RankActionErrorKey };

export async function listRankConfigHistoryAction(): Promise<RankConfigHistoryResult> {
  try {
    const actor = await requirePermission("RANK_CONFIG", new Date());
    const history = await listRankConfigHistory(actor.id);
    return {
      ok: true,
      history: history.map((r) => ({
        id: r.id,
        rankName: r.rankName,
        mrvRequired: r.mrvRequired.toString(),
        directReferralsRequired: r.directReferralsRequired,
        rewardAmount: r.rewardAmount.toString(),
        rewardType: r.rewardType,
        rankOrder: r.rankOrder,
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveTo: r.effectiveTo?.toISOString() ?? null,
        setByAdminName: r.setByAdminName,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
