"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/route-guard";
import { transferAtoB, transferCtoB, InsufficientWithdrawableBalanceError, AccountSuspendedError } from "@/lib/transfers";
import {
  releaseCapital,
  InvestmentNotOwnedError,
  CapitalStillLockedError,
  CapitalAlreadyReleasedError,
} from "@/lib/capital-release";
import { submitWithdrawalRequest, BelowMinimumWithdrawalError } from "@/lib/withdrawal-requests";
import { NotFridayError } from "@/lib/withdrawal-guard";

export type WithdrawalActionErrorKey =
  | "errorNotFriday"
  | "errorInsufficientBalance"
  | "errorSuspended"
  | "errorBelowMinimum"
  | "errorCapitalLocked"
  | "errorAlreadyReleased"
  | "errorNotOwned"
  | "errorGeneric";

export type WithdrawalActionResult = { ok: true } | { ok: false; errorKey: WithdrawalActionErrorKey };

function mapError(err: unknown): WithdrawalActionErrorKey {
  if (err instanceof NotFridayError) return "errorNotFriday";
  if (err instanceof InsufficientWithdrawableBalanceError) return "errorInsufficientBalance";
  if (err instanceof AccountSuspendedError) return "errorSuspended";
  if (err instanceof BelowMinimumWithdrawalError) return "errorBelowMinimum";
  if (err instanceof CapitalStillLockedError) return "errorCapitalLocked";
  if (err instanceof CapitalAlreadyReleasedError) return "errorAlreadyReleased";
  if (err instanceof InvestmentNotOwnedError) return "errorNotOwned";
  return "errorGeneric";
}

export async function transferAtoBAction(amount: string, locale: string): Promise<WithdrawalActionResult> {
  const user = await requireSession(new Date());
  try {
    await transferAtoB(user.id, amount, new Date());
    revalidatePath(`/${locale}/withdrawals`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function transferCtoBAction(amount: string, locale: string): Promise<WithdrawalActionResult> {
  const user = await requireSession(new Date());
  try {
    await transferCtoB(user.id, amount, new Date());
    revalidatePath(`/${locale}/withdrawals`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function releaseCapitalAction(investmentId: string, locale: string): Promise<WithdrawalActionResult> {
  const user = await requireSession(new Date());
  try {
    await releaseCapital(user.id, investmentId, new Date());
    revalidatePath(`/${locale}/withdrawals`);
    revalidatePath(`/${locale}/investments`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function submitWithdrawalRequestAction(amount: string, locale: string): Promise<WithdrawalActionResult> {
  const user = await requireSession(new Date());
  try {
    await submitWithdrawalRequest(user.id, amount, new Date());
    revalidatePath(`/${locale}/withdrawals`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
