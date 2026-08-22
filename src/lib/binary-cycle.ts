import { Prisma, type BinaryPosition } from "@prisma/client";
import { config } from "./config";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SATURDAY = "Sat";

function weekdayShort(forDate: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: config.TIMEZONE,
    weekday: "short",
  }).format(forDate);
}

/**
 * The most recent Saturday 00:00 (business timezone, Asia/Dubai) at or
 * before `forDate` — the start of the weekly binary-commission cycle
 * (docs/mlm_rules_log.md Section 5: "Saturday start -> Friday close").
 * Walks back day by day (mirrors interest-rate.ts's isFriday /
 * daysInMonthExcludingFridays pattern) rather than a weekday-offset formula,
 * so it stays correct regardless of which day forDate falls on.
 *
 * Only computes the boundary stamp for bv_entries.cycle_week_start — actual
 * weekly cycle aggregation/payout logic is a separate, later piece of work.
 */
export function saturdayWeekStart(forDate: Date): Date {
  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(forDate.getTime() - offset * MS_PER_DAY);
    if (weekdayShort(candidate) === SATURDAY) {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: config.TIMEZONE,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(candidate);
      const year = Number(parts.find((p) => p.type === "year")!.value);
      const month = Number(parts.find((p) => p.type === "month")!.value);
      const day = Number(parts.find((p) => p.type === "day")!.value);
      // Asia/Dubai is a fixed UTC+4 offset (no DST) — midnight there is
      // 20:00 UTC the prior calendar day.
      return new Date(Date.UTC(year, month - 1, day, -4, 0, 0));
    }
  }
  // Unreachable: every 7-day window contains a Saturday.
  throw new Error("No Saturday found within 7 days — this should be unreachable.");
}

/**
 * Whether `userId`'s LEFT or RIGHT leg is currently active: true if any
 * member anywhere in that leg's subtree (not necessarily a direct child)
 * currently holds capital in an ACTIVE investment and is not suspended
 * (docs/mlm_rules_log.md Section 5).
 *
 * A LIVE read against current DB state, not a stored/cached flag — this is
 * deliberately re-derived from scratch every call. Caching this result
 * safely (and re-evaluating it on capital release / suspension events) is
 * SCRUM-77's job, not this function's; this function stays a pure,
 * uncached read so that later work has a correctness baseline to check
 * itself against.
 *
 * `forDate` is accepted for signature consistency with the rest of the
 * cycle engine (invariant #4) even though this particular check doesn't
 * filter by it: capital-release.ts flips `Investment.status` to
 * CAPITAL_RELEASED immediately at release time rather than backdating it,
 * so "currently holds capital" is genuinely just "status is ACTIVE right
 * now" — there's no historical state to reconstruct for an earlier date.
 *
 * Subtree membership is computed via the materialized `path` prefix on the
 * leg's direct child (e.g. child's path "/root/mid/child/" matches every
 * node whose own path starts with that string, which is exactly the child
 * plus everyone below it).
 */
export async function isLegActive(
  userId: string,
  position: BinaryPosition,
  forDate: Date,
): Promise<boolean> {
  const legRoot = await prisma.binaryNode.findFirst({
    where: { parentId: userId, position },
    select: { path: true },
  });
  if (!legRoot) {
    return false;
  }

  const activeMember = await prisma.binaryNode.findFirst({
    where: {
      path: { startsWith: legRoot.path },
      user: {
        suspendedAt: null,
        investments: { some: { status: "ACTIVE" } },
      },
    },
    select: { userId: true },
  });

  return activeMember !== null;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

/**
 * The commission_config row active at `forDate` — historical lookup, not
 * "whatever is active now" (invariant #6: historical weeks always use the
 * rate active during that specific week). Mirrors dailyRate's lookup
 * pattern in interest-rate.ts exactly; deliberately NOT
 * direct-commission.ts's `findFirstOrThrow({ where: { effectiveTo: null }
 * })` shortcut, which only ever answers "what's active right now" and
 * would silently re-price every past week's binary commission whenever the
 * rate changes.
 */
async function activeCommissionConfigAt(forDate: Date, tx: Prisma.TransactionClient) {
  const activeConfig = await tx.commissionConfig.findFirst({
    where: {
      effectiveFrom: { lte: forDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: forDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (!activeConfig) {
    throw new Error(`No active commission_config found for ${forDate.toISOString()}.`);
  }
  return activeConfig;
}

type LegVolume = {
  /** This cycle's output carry (post-match), and the age marker for it. */
  carry: Prisma.Decimal;
  since: Date | null;
};

/**
 * Applies Carry Forward Expiry to a single leg's incoming carry: if
 * `since` is non-null and older than `expiryMonths` as of `weekStart`, the
 * carry-in is dropped (treated as 0) rather than combined into this
 * cycle's total. Only the stale CARRY-IN is affected — this week's freshly
 * -arrived BV (added by the caller afterward) was never unmatched, so it
 * can never be stale (docs/mlm_rules_log.md Section 5: "the stale portion
 * is dropped").
 */
function applyExpiry(
  carryIn: Prisma.Decimal,
  since: Date | null,
  weekStart: Date,
  expiryMonths: number,
): Prisma.Decimal {
  if (since === null) {
    return carryIn;
  }
  const expiresAt = addMonths(since, expiryMonths);
  if (weekStart >= expiresAt) {
    return new Prisma.Decimal(0);
  }
  return carryIn;
}

/**
 * The next cycle's `carryLeftSince`/`carryRightSince` for one leg, given
 * this cycle's post-match carry and the incoming `since` (already
 * expiry-checked). Null once a side is fully matched down to 0 (nothing
 * unmatched to age). If the carry survives this cycle: keep the prior
 * `since` unchanged (the unmatched streak continues) when one was already
 * running, or stamp `weekStart` (the streak starts now) when this is a
 * freshly-created carry — covers both "no prior cycle at all" and "prior
 * cycle's carry was 0" identically, since both leave `since` as null going in.
 */
function nextSince(carryOut: Prisma.Decimal, incomingSince: Date | null, weekStart: Date): Date | null {
  if (carryOut.isZero()) {
    return null;
  }
  return incomingSince ?? weekStart;
}

export type QualificationFailureReason =
  | "account_suspended"
  | "no_active_investment"
  | "left_leg_inactive"
  | "right_leg_inactive";

/**
 * Closes one user's weekly binary cycle: aggregates this week's BV against
 * carried-in volume (with Carry Forward Expiry applied to the carry-in),
 * decides qualification, pays the matched commission if qualified, and
 * writes the permanent `binary_cycles` audit row — all per
 * docs/mlm_rules_log.md Section 5 and docs/phases/phase-08-binary-cycle.md.
 *
 * Qualification checks, in order (first failure wins —
 * `qualificationReason` never enumerates more than one cause): the user
 * themselves is not suspended (build_plan.md's cross-cutting rule that
 * every commission engine skips suspended parties — Section 5's own
 * 3-condition list doesn't spell this one out explicitly, but every sibling
 * engine, daily interest and direct commission, already enforces it, and
 * leaving it out here would be the one engine that pays a suspended
 * account), has an active investment, left leg active, right leg active.
 *
 * Leg activity is SNAPSHOTTED at `weekEnd` via `isLegActive(userId,
 * position, weekEnd)` and persisted into the row's `qualified` boolean —
 * per SCRUM-77's load-bearing constraint, this is the only place permitted
 * to ask "was this leg active" for a given cycle; once written, a row's
 * qualification must never be re-derived from today's live state again
 * (a later capital release must not retroactively change an
 * already-closed week's payout decision).
 *
 * Idempotent on `(userId, weekStart)`: if a row already exists, it's
 * returned unchanged — no re-read of live state, no duplicate ledger
 * entries. The binary_cycles row (guarded by its own UNIQUE(user_id,
 * week_start) / idempotency_key) and the commission ledger credit (guarded
 * by postTransaction's own idempotency) are written in the same DB
 * transaction, so a crash between them can never leave one without the
 * other — a retry re-hits both guards independently and converges to the
 * same state.
 *
 * `weekStart`/`weekEnd` are explicit parameters, never derived from `new
 * Date()` internally (invariant #4) — a scheduler will pass the real
 * cycle's Saturday/Friday bounds (see saturdayWeekStart), tests pass
 * fabricated ones.
 */
export async function closeBinaryCycleForUser(userId: string, weekStart: Date, weekEnd: Date) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.binaryCycle.findUnique({
      where: { userId_weekStart: { userId, weekStart } },
    });
    if (existing) {
      return existing;
    }

    const config = await activeCommissionConfigAt(weekEnd, tx);

    const priorWeekStart = new Date(weekStart.getTime() - 7 * MS_PER_DAY);
    const priorCycle = await tx.binaryCycle.findUnique({
      where: { userId_weekStart: { userId, weekStart: priorWeekStart } },
    });
    const carryLeftIn = priorCycle ? new Prisma.Decimal(priorCycle.carryLeft) : new Prisma.Decimal(0);
    const carryRightIn = priorCycle ? new Prisma.Decimal(priorCycle.carryRight) : new Prisma.Decimal(0);
    const carryLeftSinceIn = priorCycle?.carryLeftSince ?? null;
    const carryRightSinceIn = priorCycle?.carryRightSince ?? null;

    const expiryMonths = config.binaryCarryForwardExpiryMonths;
    const survivingCarryLeft = applyExpiry(carryLeftIn, carryLeftSinceIn, weekStart, expiryMonths);
    const survivingCarryRight = applyExpiry(carryRightIn, carryRightSinceIn, weekStart, expiryMonths);

    const bvByLeg = await tx.bvEntry.groupBy({
      by: ["leg"],
      where: { ancestorUserId: userId, cycleWeekStart: weekStart },
      _sum: { amount: true },
    });
    const thisWeekLeft = bvByLeg.find((b) => b.leg === "LEFT")?._sum.amount ?? new Prisma.Decimal(0);
    const thisWeekRight = bvByLeg.find((b) => b.leg === "RIGHT")?._sum.amount ?? new Prisma.Decimal(0);

    const left = survivingCarryLeft.add(thisWeekLeft);
    const right = survivingCarryRight.add(thisWeekRight);

    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { suspendedAt: true } });
    const hasActiveInvestment =
      (await tx.investment.count({ where: { userId, status: "ACTIVE" } })) > 0;
    const leftActive = await isLegActive(userId, "LEFT", weekEnd);
    const rightActive = await isLegActive(userId, "RIGHT", weekEnd);

    let qualified = true;
    let qualificationReason: QualificationFailureReason | null = null;
    if (user.suspendedAt !== null) {
      qualified = false;
      qualificationReason = "account_suspended";
    } else if (!hasActiveInvestment) {
      qualified = false;
      qualificationReason = "no_active_investment";
    } else if (!leftActive) {
      qualified = false;
      qualificationReason = "left_leg_inactive";
    } else if (!rightActive) {
      qualified = false;
      qualificationReason = "right_leg_inactive";
    }

    const matched = qualified ? Prisma.Decimal.min(left, right) : new Prisma.Decimal(0);
    const commission = matched.mul(config.binaryRate).div(100);

    const carryLeftOut = left.sub(matched);
    const carryRightOut = right.sub(matched);
    const carryLeftSinceOut = nextSince(carryLeftOut, carryLeftSinceIn, weekStart);
    const carryRightSinceOut = nextSince(carryRightOut, carryRightSinceIn, weekStart);

    const idempotencyKey = `binary:${userId}:${weekStart.toISOString()}`;

    if (qualified && !matched.isZero()) {
      await postTransaction(
        {
          entries: [
            {
              userId,
              wallet: "C",
              direction: "CREDIT",
              amount: commission,
              entryType: "BINARY_COMMISSION",
              referenceType: "binary_cycle",
              referenceId: idempotencyKey,
              comment: `Binary Commission for cycle starting ${weekStart.toISOString()}.`,
            },
            {
              userId: null,
              wallet: "SYSTEM_EXTERNAL",
              direction: "DEBIT",
              amount: commission,
              entryType: "BINARY_COMMISSION",
              referenceType: "binary_cycle",
              referenceId: idempotencyKey,
              comment: `Binary Commission for cycle starting ${weekStart.toISOString()}.`,
            },
          ],
          idempotencyKey,
        },
        tx,
      );
    }

    return tx.binaryCycle.create({
      data: {
        userId,
        weekStart,
        weekEnd,
        leftVolume: left,
        rightVolume: right,
        matchedVolume: matched,
        commissionPaid: commission,
        carryLeft: carryLeftOut,
        carryRight: carryRightOut,
        carryLeftSince: carryLeftSinceOut,
        carryRightSince: carryRightSinceOut,
        qualified,
        qualificationReason,
        idempotencyKey,
      },
    });
  });
}

/**
 * The logged-in user's own most recently closed binary cycle, or null if
 * none has ever run for them (no `binary_cycles` row exists yet — e.g. a
 * brand-new user, or one placed after the last close). No target-user
 * param — ownership enforced by construction (invariant #9): only ever
 * call this with the session's own userId.
 */
export async function getMyLatestBinaryCycle(userId: string) {
  return prisma.binaryCycle.findFirst({
    where: { userId },
    orderBy: { weekStart: "desc" },
  });
}

/**
 * Whole days remaining until the next Saturday 00:00 in the business
 * timezone (Asia/Dubai) — the next weekly binary cycle close — relative
 * to `now` (explicit param per invariant #4, even for display-only
 * logic). Returns 0 if `now` is already Saturday there, mirroring
 * `daysUntilNextFriday`'s convention in next-friday.ts (0 means "today",
 * never a negative countdown).
 */
export function daysUntilNextSaturday(now: Date): number {
  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(now.getTime() + offset * MS_PER_DAY);
    if (weekdayShort(candidate) === SATURDAY) {
      return offset;
    }
  }
  // Unreachable: every 7-day window contains a Saturday.
  return 0;
}
