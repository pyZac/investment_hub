"use server";

import { revalidatePath } from "next/cache";
import { requireMainAdmin } from "@/lib/route-guard";
import { updateAdminEmail, EmailAlreadyInUseError, IncorrectPasswordError } from "@/lib/auth";
import { beginTotpReenrollment, confirmTotpReenrollment } from "@/lib/totp-enrollment";

export type SettingsActionErrorKey =
  | "errorEmailInUse"
  | "errorIncorrectPassword"
  | "errorInvalidCode"
  | "errorGeneric";

function mapError(err: unknown): SettingsActionErrorKey {
  if (err instanceof EmailAlreadyInUseError) return "errorEmailInUse";
  if (err instanceof IncorrectPasswordError) return "errorIncorrectPassword";
  if (err instanceof Error && /invalid authentication code/i.test(err.message)) return "errorInvalidCode";
  return "errorGeneric";
}

export type SettingsActionResult = { ok: true } | { ok: false; errorKey: SettingsActionErrorKey };

/**
 * Every action here calls requireMainAdmin() first (invariant #8/#9) — main
 * admin account settings is not part of the grantable permission catalog
 * and never trusts a client-supplied identity; the acting admin's own
 * session is always the target of the change.
 */
export async function updateAdminEmailAction(
  currentPassword: string,
  newEmail: string,
  locale: string,
): Promise<SettingsActionResult> {
  try {
    const actor = await requireMainAdmin(new Date());
    await updateAdminEmail(actor.id, { currentPassword, newEmail }, new Date());
    revalidatePath(`/${locale}/admin/settings`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type BeginReenrollResult =
  | { ok: true; secret: string; otpauthUri: string }
  | { ok: false; errorKey: SettingsActionErrorKey };

export async function beginTotpReenrollmentAction(): Promise<BeginReenrollResult> {
  try {
    const actor = await requireMainAdmin(new Date());
    const { secret, otpauthUri } = beginTotpReenrollment(actor.email);
    return { ok: true, secret, otpauthUri };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export async function confirmTotpReenrollmentAction(
  secret: string,
  code: string,
  locale: string,
): Promise<SettingsActionResult> {
  try {
    const actor = await requireMainAdmin(new Date());
    await confirmTotpReenrollment(actor.id, secret, code, new Date());
    revalidatePath(`/${locale}/admin/settings`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
