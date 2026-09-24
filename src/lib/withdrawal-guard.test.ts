import { afterEach, describe, expect, it } from "vitest";
import { assertFriday, NotFridayError } from "./withdrawal-guard";
import { prisma } from "./prisma";
import { DEVELOPER_TOOLS_SETTINGS_ID } from "./developer-tools-constants";

afterEach(async () => {
  // Every test in this file must leave the real singleton row exactly as it
  // started (bypass off) — other test files (transfers.test.ts,
  // capital-release.test.ts, withdrawal-requests.test.ts) assume the real
  // Friday gate is active unless they turn it on themselves.
  await prisma.developerToolsSetting.update({
    where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
    data: { bypassFridayGate: false, updatedByAdminId: null },
  });
});

describe("assertFriday", () => {
  it("does not throw for a plain Friday instant", async () => {
    // 2026-08-21 is a Friday; noon UTC is also Friday in Asia/Dubai (UTC+4).
    await expect(assertFriday(new Date("2026-08-21T12:00:00.000Z"))).resolves.not.toThrow();
  });

  it("throws for a plain Thursday instant", async () => {
    await expect(assertFriday(new Date("2026-08-20T12:00:00.000Z"))).rejects.toThrow(NotFridayError);
  });

  it("does not throw when UTC is still Thursday but Dubai has already rolled into Friday", async () => {
    // 2026-08-20T20:30:00Z is Thursday in UTC, but 2026-08-21T00:30 in
    // Asia/Dubai (UTC+4) — already Friday there.
    await expect(assertFriday(new Date("2026-08-20T20:30:00.000Z"))).resolves.not.toThrow();
  });

  it("throws when UTC is still Friday but Dubai has already rolled into Saturday", async () => {
    // 2026-08-21T20:30:00Z is Friday in UTC, but 2026-08-22T00:30 in
    // Asia/Dubai (UTC+4) — already Saturday there.
    await expect(assertFriday(new Date("2026-08-21T20:30:00.000Z"))).rejects.toThrow(NotFridayError);
  });

  it("throws with the expected user-facing message", async () => {
    await expect(assertFriday(new Date("2026-08-20T12:00:00.000Z"))).rejects.toThrow(
      /only available on fridays/i,
    );
  });

  describe("with the Developer Tools bypass flag on", () => {
    it("does not throw on a non-Friday when bypassFridayGate is true", async () => {
      await prisma.developerToolsSetting.update({
        where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
        data: { bypassFridayGate: true },
      });

      // 2026-08-20 is a Thursday — would normally throw.
      await expect(assertFriday(new Date("2026-08-20T12:00:00.000Z"))).resolves.not.toThrow();
    });

    it("still does not throw on an actual Friday when the flag is true (bypass is not a Friday-only override)", async () => {
      await prisma.developerToolsSetting.update({
        where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
        data: { bypassFridayGate: true },
      });

      await expect(assertFriday(new Date("2026-08-21T12:00:00.000Z"))).resolves.not.toThrow();
    });

    it("goes back to throwing on a non-Friday once the flag is turned back off", async () => {
      await prisma.developerToolsSetting.update({
        where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
        data: { bypassFridayGate: true },
      });
      await expect(assertFriday(new Date("2026-08-20T12:00:00.000Z"))).resolves.not.toThrow();

      await prisma.developerToolsSetting.update({
        where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
        data: { bypassFridayGate: false },
      });
      await expect(assertFriday(new Date("2026-08-20T12:00:00.000Z"))).rejects.toThrow(NotFridayError);
    });
  });
});
