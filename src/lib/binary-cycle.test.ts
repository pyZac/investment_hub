import { describe, expect, it } from "vitest";
import { saturdayWeekStart } from "./binary-cycle";

describe("saturdayWeekStart", () => {
  it("returns the same instant for a Saturday 00:00 Dubai input", () => {
    // 2026-08-22 is a Saturday. Midnight Dubai (UTC+4) is 2026-08-21T20:00:00Z.
    const saturdayMidnightDubai = new Date("2026-08-21T20:00:00.000Z");
    const result = saturdayWeekStart(saturdayMidnightDubai);
    expect(result.toISOString()).toBe("2026-08-21T20:00:00.000Z");
  });

  it("walks back to the prior Saturday for a mid-week date", () => {
    // 2026-08-25 is a Tuesday, same week as the 2026-08-22 Saturday.
    const tuesday = new Date("2026-08-25T10:00:00.000Z");
    const result = saturdayWeekStart(tuesday);
    expect(result.toISOString()).toBe("2026-08-21T20:00:00.000Z");
  });

  it("walks back to the prior Saturday for a Friday (end of that week's cycle)", () => {
    // 2026-08-28 is a Friday, closing the week that started Saturday 2026-08-22.
    const friday = new Date("2026-08-28T15:00:00.000Z");
    const result = saturdayWeekStart(friday);
    expect(result.toISOString()).toBe("2026-08-21T20:00:00.000Z");
  });

  it("handles the UTC/Dubai boundary correctly (UTC-Friday-but-Dubai-Saturday)", () => {
    // 2026-08-21T21:00:00Z is Friday 21:00 UTC, but 2026-08-22 01:00 in
    // Dubai (UTC+4) — already Saturday there, so it should be its own
    // week's start, not walk back to the prior week.
    const utcFridayDubaiSaturday = new Date("2026-08-21T21:00:00.000Z");
    const result = saturdayWeekStart(utcFridayDubaiSaturday);
    expect(result.toISOString()).toBe("2026-08-21T20:00:00.000Z");
  });
});
