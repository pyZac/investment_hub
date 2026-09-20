"use server";

import { registerWithSponsor, validateReferralCode } from "@/lib/users";

export type RegisterActionErrorKey =
  | "errorInvalidRef"
  | "errorEmailInUse"
  | "errorPasswordMismatch"
  | "errorGeneric";

function mapError(err: unknown): RegisterActionErrorKey {
  if (err instanceof Error) {
    if (/sponsor not found|sponsor account is suspended/i.test(err.message)) return "errorInvalidRef";
    if (/unique constraint/i.test(err.message) || /email/i.test(err.message)) return "errorEmailInUse";
  }
  return "errorGeneric";
}

export type RegisterActionInput = {
  referralCode: string;
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  isMarketer: boolean;
  securityQuestions: { question: string; answer: string }[];
};

export type RegisterActionResult = { ok: true } | { ok: false; errorKey: RegisterActionErrorKey };

/**
 * Public, unauthenticated action — no requireSession. The referral code is
 * re-validated here even though the page already validated it server-side
 * on render: this action is a separate entry point a client could call
 * directly, so the page's own validation is not by itself the real
 * enforcement boundary (defense in depth, same posture as every other
 * "page validates, action re-validates" pair in this codebase).
 * password/confirmPassword match is also re-checked here, never trusted
 * from client-side validation alone.
 */
export async function registerAction(input: RegisterActionInput): Promise<RegisterActionResult> {
  if (input.password !== input.confirmPassword) {
    return { ok: false, errorKey: "errorPasswordMismatch" };
  }

  const validation = await validateReferralCode(input.referralCode);
  if (!validation.valid) {
    return { ok: false, errorKey: "errorInvalidRef" };
  }

  try {
    await registerWithSponsor(input.referralCode, {
      email: input.email,
      password: input.password,
      name: input.name,
      isMarketer: input.isMarketer,
      securityQuestions: input.securityQuestions,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
