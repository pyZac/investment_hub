"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/route-guard";
import {
  transferBetweenUsers,
  searchTransferRecipients,
  BelowMinimumTransferError,
  InsufficientWalletBBalanceError,
  RecipientNotFoundError,
  SelfTransferError,
} from "@/lib/user-transfer";
import { AccountSuspendedError } from "@/lib/transfers";

export type TransferActionErrorKey =
  | "errorBelowMinimum"
  | "errorInsufficientBalance"
  | "errorSuspended"
  | "errorRecipientNotFound"
  | "errorSelfTransfer"
  | "errorGeneric";

function mapError(err: unknown): TransferActionErrorKey {
  if (err instanceof BelowMinimumTransferError) return "errorBelowMinimum";
  if (err instanceof InsufficientWalletBBalanceError) return "errorInsufficientBalance";
  if (err instanceof AccountSuspendedError) return "errorSuspended";
  if (err instanceof RecipientNotFoundError) return "errorRecipientNotFound";
  if (err instanceof SelfTransferError) return "errorSelfTransfer";
  return "errorGeneric";
}

export type RecipientOption = { id: string; name: string; email: string };
export type SearchRecipientsResult = { ok: true; recipients: RecipientOption[] } | { ok: false; errorKey: TransferActionErrorKey };

/**
 * Backs the recipient picker. Unlike the admin manual-adjustment user
 * picker, this is self-service — any authenticated user may search for a
 * transfer recipient, scoped to excluding themselves and suspended
 * accounts (searchTransferRecipients itself enforces both).
 */
export async function searchRecipientsAction(query: string): Promise<SearchRecipientsResult> {
  try {
    const user = await requireSession(new Date());
    const recipients = await searchTransferRecipients(user.id, query);
    return { ok: true, recipients };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type TransferActionResult = { ok: true } | { ok: false; errorKey: TransferActionErrorKey };

/**
 * senderId is always the caller's own session id (invariant #9) — never a
 * client-supplied value, so a client cannot debit an arbitrary user's Wallet
 * B by tampering with a form field. The idempotency key is generated here,
 * per real click, matching the transferAtoB/transferCtoB precedent: each
 * legitimate transfer a user submits is its own event, not a replay of a
 * previous one.
 */
export async function transferToUserAction(recipientId: string, amount: string, locale: string): Promise<TransferActionResult> {
  const user = await requireSession(new Date());
  try {
    const idempotencyKey = `user_transfer:${user.id}:${randomUUID()}`;
    await transferBetweenUsers(user.id, recipientId, amount, idempotencyKey);
    revalidatePath(`/${locale}/transfer`);
    revalidatePath(`/${locale}/withdrawals`);
    revalidatePath(`/${locale}/transactions`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
