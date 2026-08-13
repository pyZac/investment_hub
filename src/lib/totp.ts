import * as OTPAuth from "otpauth";

const ISSUER = "Investment Hub";

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function totpOtpauthUri(secret: string, accountEmail: string): string {
  const totp = new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountEmail,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.toString();
}

/**
 * Verifies a 6-digit TOTP code against the stored secret, allowing one
 * 30-second step of drift in either direction to tolerate clock skew.
 */
export function verifyTotpCode(secret: string, code: string): boolean {
  const totp = new OTPAuth.TOTP({
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}
