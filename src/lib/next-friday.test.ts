import { describe, expect, it } from "vitest";
import { daysUntilNextFriday } from "./next-friday";

describe("daysUntilNextFriday", () => {
  it("returns 0 when already Friday (Asia/Dubai)", () => {
    // 2026-08-21 is a Friday; noon UTC is also Friday in Asia/Dubai (UTC+4).
    expect(daysUntilNextFriday(new Date("2026-08-21T12:00:00.000Z"))).toBe(0);
  });

  it("returns 1 on a Thursday", () => {
    expect(daysUntilNextFriday(new Date("2026-08-20T12:00:00.000Z"))).toBe(1);
  });

  it("returns 6 on a Saturday (the day right after Friday)", () => {
    // 2026-08-22 is a Saturday.
    expect(daysUntilNextFriday(new Date("2026-08-22T12:00:00.000Z"))).toBe(6);
  });

  it("returns 0 when UTC is still Thursday but Dubai has already rolled into Friday", () => {
    // 2026-08-20T20:30:00Z is Thursday in UTC, but 2026-08-21T00:30 in
    // Asia/Dubai (UTC+4) — already Friday there.
    expect(daysUntilNextFriday(new Date("2026-08-20T20:30:00.000Z"))).toBe(0);
  });

  it("returns 6 when UTC is still Friday but Dubai has already rolled into Saturday", () => {
    // 2026-08-21T20:30:00Z is Friday in UTC, but 2026-08-22T00:30 in
    // Asia/Dubai (UTC+4) — already Saturday there.
    expect(daysUntilNextFriday(new Date("2026-08-21T20:30:00.000Z"))).toBe(6);
  });

  it("stays correct near a late-day instant that could roll into the next UTC calendar day", () => {
    // 2026-08-19T23:50:00Z (Wednesday, late UTC) is 2026-08-20T03:50 in
    // Asia/Dubai — still Thursday there. Next Friday is 1 day away.
    expect(daysUntilNextFriday(new Date("2026-08-19T23:50:00.000Z"))).toBe(1);
  });
});
