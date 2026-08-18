import { describe, expect, it } from "vitest";
import { assertFriday, NotFridayError } from "./withdrawal-guard";

describe("assertFriday", () => {
  it("does not throw for a plain Friday instant", () => {
    // 2026-08-21 is a Friday; noon UTC is also Friday in Asia/Dubai (UTC+4).
    expect(() => assertFriday(new Date("2026-08-21T12:00:00.000Z"))).not.toThrow();
  });

  it("throws for a plain Thursday instant", () => {
    expect(() => assertFriday(new Date("2026-08-20T12:00:00.000Z"))).toThrow(NotFridayError);
  });

  it("does not throw when UTC is still Thursday but Dubai has already rolled into Friday", () => {
    // 2026-08-20T20:30:00Z is Thursday in UTC, but 2026-08-21T00:30 in
    // Asia/Dubai (UTC+4) — already Friday there.
    expect(() => assertFriday(new Date("2026-08-20T20:30:00.000Z"))).not.toThrow();
  });

  it("throws when UTC is still Friday but Dubai has already rolled into Saturday", () => {
    // 2026-08-21T20:30:00Z is Friday in UTC, but 2026-08-22T00:30 in
    // Asia/Dubai (UTC+4) — already Saturday there.
    expect(() => assertFriday(new Date("2026-08-21T20:30:00.000Z"))).toThrow(NotFridayError);
  });

  it("throws with the expected user-facing message", () => {
    expect(() => assertFriday(new Date("2026-08-20T12:00:00.000Z"))).toThrow(
      /only available on fridays/i,
    );
  });
});
