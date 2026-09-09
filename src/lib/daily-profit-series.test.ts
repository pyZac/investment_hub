import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildDailyProfitSeries } from "./daily-profit-series";

describe("buildDailyProfitSeries", () => {
  // 2026-06-08 = Monday, 2026-06-12 = Friday, 2026-06-13 = Saturday, in
  // Asia/Dubai. Noon-UTC-offset instants (08:00Z = 12:00 Dubai) keep every
  // date safely inside its intended Dubai calendar day.
  const MON = new Date("2026-06-08T08:00:00.000Z");
  const TUE = new Date("2026-06-09T08:00:00.000Z");
  const FRI = new Date("2026-06-12T08:00:00.000Z");
  const SAT = new Date("2026-06-13T08:00:00.000Z");

  it("produces one point per day across the range, inclusive of both ends", () => {
    const series = buildDailyProfitSeries(new Map(), MON, TUE);

    expect(series.map((p) => p.date)).toEqual(["2026-06-08", "2026-06-09"]);
  });

  it("flags Friday as a null-amount gap, never a zero", () => {
    const history = new Map([["2026-06-12", new Prisma.Decimal("999")]]);

    const series = buildDailyProfitSeries(history, FRI, FRI);

    expect(series).toEqual([{ date: "2026-06-12", amount: null, isFriday: true }]);
  });

  it("defaults a non-Friday day with no history entry to a real zero, not null", () => {
    const series = buildDailyProfitSeries(new Map(), MON, MON);

    expect(series).toEqual([{ date: "2026-06-08", amount: 0, isFriday: false }]);
  });

  it("renders real credited amounts for non-Friday days present in history", () => {
    const history = new Map([["2026-06-08", new Prisma.Decimal("42.10")]]);

    const series = buildDailyProfitSeries(history, MON, MON);

    expect(series).toEqual([{ date: "2026-06-08", amount: 42.1, isFriday: false }]);
  });

  it("keys points by Dubai day even when fromDate/toDate aren't midnight-aligned", () => {
    // Regression test: a real production bug had this function key its
    // walked days by the UTC date of an arbitrary `toDate` instant (e.g.
    // `new Date()` at 19:08 Dubai time), while `getDailyInterestHistoryA`'s
    // history map is keyed by the Dubai calendar day — these only
    // coincidentally matched when a test's fixture happened to sit at noon
    // Dubai. 2026-06-08T19:08:00.000Z is 2026-06-08T23:08+04:00 — still
    // June 8th in Dubai, but a UTC-date key would read June 8th too (this
    // instant happens to agree); the real regression is exercised by an
    // instant whose UTC date and Dubai date actually differ, e.g. late
    // evening UTC that rolls into the next Dubai day.
    const lateUtcSameDubaiDay = new Date("2026-06-08T21:30:00.000Z"); // 01:30 Dubai, June 9th
    const history = new Map([["2026-06-09", new Prisma.Decimal("18.4")]]);

    const series = buildDailyProfitSeries(history, lateUtcSameDubaiDay, lateUtcSameDubaiDay);

    expect(series).toEqual([{ date: "2026-06-09", amount: 18.4, isFriday: false }]);
  });

  it("spans a Friday correctly inside a longer range: Thu, Fri (gap), Sat", () => {
    const thursday = new Date("2026-06-11T08:00:00.000Z");
    const history = new Map([
      ["2026-06-11", new Prisma.Decimal("10")],
      ["2026-06-13", new Prisma.Decimal("20")],
    ]);

    const series = buildDailyProfitSeries(history, thursday, SAT);

    expect(series).toEqual([
      { date: "2026-06-11", amount: 10, isFriday: false },
      { date: "2026-06-12", amount: null, isFriday: true },
      { date: "2026-06-13", amount: 20, isFriday: false },
    ]);
  });
});
