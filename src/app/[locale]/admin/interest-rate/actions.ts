"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/route-guard";
import { setInterestRate, getCurrentRate, listRateHistory, BackdatedRateError } from "@/lib/rate-config";

export type RateActionErrorKey =
  | "errorRateInvalid"
  | "errorDateInvalid"
  | "errorBackdated"
  | "errorReasonRequired"
  | "errorForbidden"
  | "errorGeneric";

function mapError(err: unknown): RateActionErrorKey {
  if (err instanceof BackdatedRateError) return "errorBackdated";
  if (err instanceof Error) {
    if (/forbidden/i.test(err.message)) return "errorForbidden";
    if (/reason/i.test(err.message)) return "errorReasonRequired";
  }
  return "errorGeneric";
}

export type RateActionResult = { ok: true } | { ok: false; errorKey: RateActionErrorKey };

/**
 * Calls requirePermission("RATE_CONFIG", ...) first — the real
 * server-side enforcement point (invariant #8), independent of
 * rate-config.ts's own inline requireRateConfigPermission re-check. The
 * effective date's own future-only check happens inside setInterestRate
 * itself (server-side, not just a UI date-picker minimum) — this action
 * only re-validates it's a well-formed date before parsing.
 */
export async function setInterestRateAction(
  monthlyRate: string,
  effectiveFromDate: string,
  reason: string,
  locale: string,
): Promise<RateActionResult> {
  const parsedRate = Number(monthlyRate);
  if (!monthlyRate || Number.isNaN(parsedRate) || parsedRate <= 0) {
    return { ok: false, errorKey: "errorRateInvalid" };
  }
  const effectiveFrom = new Date(`${effectiveFromDate}T00:00:00.000Z`);
  if (!effectiveFromDate || Number.isNaN(effectiveFrom.getTime())) {
    return { ok: false, errorKey: "errorDateInvalid" };
  }
  if (!reason.trim()) {
    return { ok: false, errorKey: "errorReasonRequired" };
  }

  try {
    const actor = await requirePermission("RATE_CONFIG", new Date());
    await setInterestRate(actor.id, { monthlyRate, effectiveFrom, reason }, new Date());
    revalidatePath(`/${locale}/admin/interest-rate`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type CurrentRateResult =
  | { ok: true; rate: { monthlyRate: string; effectiveFrom: string; setByAdminName: string | null } | null }
  | { ok: false; errorKey: RateActionErrorKey };

export async function getCurrentRateAction(): Promise<CurrentRateResult> {
  try {
    const actor = await requirePermission("RATE_CONFIG", new Date());
    const current = await getCurrentRate(actor.id, new Date());
    return {
      ok: true,
      rate: current
        ? {
            monthlyRate: current.monthlyRate.toString(),
            effectiveFrom: current.effectiveFrom.toISOString(),
            setByAdminName: current.setByAdmin?.name ?? null,
          }
        : null,
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type RateHistoryRow = {
  id: string;
  monthlyRate: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  setByAdminName: string | null;
  createdAt: string;
};

export type RateHistoryResult = { ok: true; history: RateHistoryRow[] } | { ok: false; errorKey: RateActionErrorKey };

export async function listRateHistoryAction(): Promise<RateHistoryResult> {
  try {
    const actor = await requirePermission("RATE_CONFIG", new Date());
    const history = await listRateHistory(actor.id);
    return {
      ok: true,
      history: history.map((r) => ({
        id: r.id,
        monthlyRate: r.monthlyRate.toString(),
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
