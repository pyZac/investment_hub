"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/route-guard";
import {
  setCommissionConfig,
  getCurrentCommissionConfig,
  listCommissionConfigHistory,
  BackdatedCommissionConfigError,
  SplitMismatchError,
} from "@/lib/commission-config";

export type CommissionActionErrorKey =
  | "errorRateInvalid"
  | "errorSplitInvalid"
  | "errorSplitMismatch"
  | "errorMonthsInvalid"
  | "errorDateInvalid"
  | "errorBackdated"
  | "errorReasonRequired"
  | "errorForbidden"
  | "errorGeneric";

function mapError(err: unknown): CommissionActionErrorKey {
  if (err instanceof BackdatedCommissionConfigError) return "errorBackdated";
  if (err instanceof SplitMismatchError) return "errorSplitMismatch";
  if (err instanceof Error) {
    if (/forbidden/i.test(err.message)) return "errorForbidden";
    if (/reason/i.test(err.message)) return "errorReasonRequired";
  }
  return "errorGeneric";
}

export type CommissionActionResult = { ok: true } | { ok: false; errorKey: CommissionActionErrorKey };

/**
 * Calls requirePermission("COMMISSION_CONFIG", ...) first — the real
 * server-side enforcement point (invariant #8), independent of
 * commission-config.ts's own inline re-check. The effective date's
 * future-only check happens inside setCommissionConfig itself (server-side,
 * not just a UI date-picker minimum); this action only re-validates
 * well-formed input before parsing.
 */
export async function setCommissionConfigAction(
  directRate: string,
  directCommissionSplit: string,
  directSavingSplit: string,
  binaryRate: string,
  binaryCarryForwardExpiryMonths: string,
  effectiveFromDate: string,
  reason: string,
  locale: string,
): Promise<CommissionActionResult> {
  const parsedDirectRate = Number(directRate);
  const parsedBinaryRate = Number(binaryRate);
  if (!directRate || Number.isNaN(parsedDirectRate) || parsedDirectRate <= 0) {
    return { ok: false, errorKey: "errorRateInvalid" };
  }
  if (!binaryRate || Number.isNaN(parsedBinaryRate) || parsedBinaryRate <= 0) {
    return { ok: false, errorKey: "errorRateInvalid" };
  }

  const parsedCommissionSplit = Number(directCommissionSplit);
  const parsedSavingSplit = Number(directSavingSplit);
  if (
    !directCommissionSplit ||
    !directSavingSplit ||
    Number.isNaN(parsedCommissionSplit) ||
    Number.isNaN(parsedSavingSplit) ||
    parsedCommissionSplit < 0 ||
    parsedSavingSplit < 0
  ) {
    return { ok: false, errorKey: "errorSplitInvalid" };
  }

  const parsedMonths = Number(binaryCarryForwardExpiryMonths);
  if (!binaryCarryForwardExpiryMonths || !Number.isInteger(parsedMonths) || parsedMonths <= 0) {
    return { ok: false, errorKey: "errorMonthsInvalid" };
  }

  const effectiveFrom = new Date(`${effectiveFromDate}T00:00:00.000Z`);
  if (!effectiveFromDate || Number.isNaN(effectiveFrom.getTime())) {
    return { ok: false, errorKey: "errorDateInvalid" };
  }
  if (!reason.trim()) {
    return { ok: false, errorKey: "errorReasonRequired" };
  }

  try {
    const actor = await requirePermission("COMMISSION_CONFIG", new Date());
    await setCommissionConfig(
      actor.id,
      {
        directRate,
        directCommissionSplit,
        directSavingSplit,
        binaryRate,
        binaryCarryForwardExpiryMonths: parsedMonths,
        effectiveFrom,
        reason,
      },
      new Date(),
    );
    revalidatePath(`/${locale}/admin/commission-config`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type CurrentCommissionConfigResult =
  | {
      ok: true;
      config: {
        directRate: string;
        directCommissionSplit: string;
        directSavingSplit: string;
        binaryRate: string;
        binaryCarryForwardExpiryMonths: number;
        effectiveFrom: string;
        setByAdminName: string | null;
      } | null;
    }
  | { ok: false; errorKey: CommissionActionErrorKey };

export async function getCurrentCommissionConfigAction(): Promise<CurrentCommissionConfigResult> {
  try {
    const actor = await requirePermission("COMMISSION_CONFIG", new Date());
    const current = await getCurrentCommissionConfig(actor.id, new Date());
    return {
      ok: true,
      config: current
        ? {
            directRate: current.directRate.toString(),
            directCommissionSplit: current.directCommissionSplit.toString(),
            directSavingSplit: current.directSavingSplit.toString(),
            binaryRate: current.binaryRate.toString(),
            binaryCarryForwardExpiryMonths: current.binaryCarryForwardExpiryMonths,
            effectiveFrom: current.effectiveFrom.toISOString(),
            setByAdminName: current.setByAdmin?.name ?? null,
          }
        : null,
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type CommissionConfigHistoryRow = {
  id: string;
  directRate: string;
  directCommissionSplit: string;
  directSavingSplit: string;
  binaryRate: string;
  binaryCarryForwardExpiryMonths: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  setByAdminName: string | null;
  createdAt: string;
};

export type CommissionConfigHistoryResult =
  | { ok: true; history: CommissionConfigHistoryRow[] }
  | { ok: false; errorKey: CommissionActionErrorKey };

export async function listCommissionConfigHistoryAction(): Promise<CommissionConfigHistoryResult> {
  try {
    const actor = await requirePermission("COMMISSION_CONFIG", new Date());
    const history = await listCommissionConfigHistory(actor.id);
    return {
      ok: true,
      history: history.map((r) => ({
        id: r.id,
        directRate: r.directRate.toString(),
        directCommissionSplit: r.directCommissionSplit.toString(),
        directSavingSplit: r.directSavingSplit.toString(),
        binaryRate: r.binaryRate.toString(),
        binaryCarryForwardExpiryMonths: r.binaryCarryForwardExpiryMonths,
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveTo: r.effectiveTo?.toISOString() ?? null,
        setByAdminName: r.setByAdmin?.name ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
