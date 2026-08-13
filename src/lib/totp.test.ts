import { describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import { generateTotpSecret, totpOtpauthUri, verifyTotpCode } from "./totp";

describe("generateTotpSecret", () => {
  it("generates distinct base32 secrets", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Z2-7]+=*$/);
  });
});

describe("totpOtpauthUri", () => {
  it("embeds the issuer and account email", () => {
    const secret = generateTotpSecret();
    const uri = totpOtpauthUri(secret, "admin@example.com");
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(encodeURIComponent("admin@example.com"));
    expect(uri).toContain("Investment%20Hub");
  });
});

describe("verifyTotpCode", () => {
  it("accepts the current valid code", () => {
    const secret = generateTotpSecret();
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secret),
    });
    const code = totp.generate();
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it("rejects an incorrect code", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "000000")).toBe(false);
  });

  it("rejects a code generated from a different secret", () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const totpB = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(secretB),
    });
    expect(verifyTotpCode(secretA, totpB.generate())).toBe(false);
  });
});
