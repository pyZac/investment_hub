import { z } from "zod";
import { Prisma, type RankRewardType } from "@prisma/client";
import { config } from "./config";
import { prisma } from "./prisma";
import { postTransaction } from "./ledger-transaction";

/**
 * `forDate`'s calendar month as "YYYY-MM" in the business timezone
 * (Asia/Dubai), not raw UTC — mirrors saturdayWeekStart's
 * Intl.DateTimeFormat pattern in binary-cycle.ts. A date whose UTC day
 * still reads as the prior month can already be the 1st of the new month in
 * Dubai (UTC+4), so this must resolve against Asia/Dubai, not
 * `date.toISOString()`.
 */
export function dubaiMonthKey(forDate: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: config.TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(forDate);
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  return `${year}-${month}`;
}

/**
 * Accrues Monthly Rank Volume for a package purchase: adds `amount` to the
 * buyer's DIRECT SPONSOR's current-month mrv_periods row (upsert), using the
 * sponsor tree (users.sponsor_id) — never the placement tree (invariant #5,
 * do not conflate with rollupBvForPurchase's binary_nodes walk).
 *
 * Depth = 1 level only (docs/mlm_rules_log.md Section 6): only the buyer's
 * immediate sponsor is credited. A referral's own downline purchases never
 * roll up further — there is no ancestor walk here, unlike BV's unlimited
 * placement-tree rollup.
 *
 * Every purchase counts — new purchases AND reinvestments alike, no
 * first-purchase-only gate (deliberately different from Direct Commission's
 * isDirectCommissionTriggerPurchase, see that function's own doc comment).
 * A buyer with no sponsor (a root user) accrues nothing for anyone,
 * including themselves — MRV only ever credits a direct sponsor, never a
 * self-credit.
 *
 * `tx` is required, not optional (matches rollupBvForPurchase's and
 * payDirectCommissionInTx's reasoning): must run inside the same
 * transaction as the purchase/investment write, so a crash never leaves MRV
 * accrued for a purchase that didn't actually commit, or vice versa.
 *
 * Idempotency: unlike BvEntry (which has its own row-per-purchase unique
 * constraint), mrv_periods stores a running SUM per (user, month), not one
 * row per purchase — so there is no natural per-purchase replay guard at
 * this table alone. This is safe because the only caller, purchasePackage,
 * already guards its entire transaction (including this call) behind its
 * own idempotencyKey replay check before ever reaching this function on the
 * newly-created path — a replay short-circuits before rollupBvForPurchase/
 * accrueMrvForPurchase are ever invoked a second time for the same purchase.
 */
export async function accrueMrvForPurchase(
  buyerId: string,
  amount: Prisma.Decimal | string,
  forDate: Date,
  tx: Prisma.TransactionClient,
): Promise<void> {
  const buyer = await tx.user.findUniqueOrThrow({
    where: { id: buyerId },
    select: { sponsorId: true },
  });
  if (!buyer.sponsorId) {
    return;
  }

  const month = dubaiMonthKey(forDate);

  await tx.mrvPeriod.upsert({
    where: { userId_month: { userId: buyer.sponsorId, month } },
    create: {
      userId: buyer.sponsorId,
      month,
      volume: amount,
    },
    update: {
      volume: { increment: amount },
    },
  });
}

/**
 * Live count of `userId`'s qualified direct referrals: directly sponsored
 * users (users.sponsor_id, depth 1 only) who currently hold at least one
 * ACTIVE investment. Same reasoning as isLegActive in binary-cycle.ts — a
 * pure, uncached read derived from current DB state every call, not a
 * stored/incrementally-maintained counter, so it never drifts out of sync
 * with capital-release or suspension events.
 */
export async function qualifiedDirectReferralCount(userId: string): Promise<number> {
  return prisma.user.count({
    where: {
      sponsorId: userId,
      suspendedAt: null,
      investments: { some: { status: "ACTIVE" } },
    },
  });
}

export type RankEvaluationResult =
  | { granted: true; rank: string }
  | { granted: false; rank: null };

/**
 * Evaluates one user's rank qualification for one already-completed
 * calendar month and grants the single highest newly-achieved rank, if any
 * (docs/mlm_rules_log.md Section 6): both MRV and qualified-direct-referral
 * thresholds must be met within that same month, the user must themselves
 * hold an active investment, and only the highest rank crossed is
 * granted/recorded — lower ranks crossed in the same month are never
 * separately awarded, even though the user technically also qualified for
 * them.
 *
 * A rank already granted (rank_awards has a row for this user+rank, from
 * ANY month, ever) is permanently skipped — re-crossing the threshold in a
 * later month grants nothing (invariant #6, and mlm_rules_log's explicit
 * "reward is paid once only per rank, ever"). This is enforced both by this
 * function's own pre-check (so a repeat call is a fast, clean no-op) and by
 * the DB-level UNIQUE(user_id, rank) constraint as the final backstop.
 *
 * Lower ranks crossed the SAME month a higher rank is granted are recorded
 * as permanently FORFEITED (rank_forfeits), not just silently skipped for
 * this call: without this, a lower rank whose threshold was met but not
 * paid (because a higher rank won that month) would remain eligible to be
 * claimed in some future month where the user's performance merely repeats
 * the same numbers — which would contradict "only the highest is paid" by
 * effectively paying the lower rank later anyway. Once forfeited, a rank
 * stays forfeited forever, mirroring rank_awards' own permanence.
 *

 * `month` is the completed month being evaluated ("YYYY-MM", Asia/Dubai) —
 * a parameter, not derived from `forDate`, so a catch-up-style caller can
 * evaluate a past month explicitly. `forDate` is accepted for invariant #4
 * signature consistency (this function performs no date arithmetic of its
 * own beyond what's already baked into the month string and the live
 * referral-count read, which has no historical variant — same reasoning as
 * isLegActive's own forDate parameter).
 *
 * This is a per-user engine function (mirrors closeBinaryCycleForUser's
 * shape) — the batch/job wrapper iterating every user with job_runs
 * catch-up tracking is a separate, later ticket.
 *
 * Grants only; never touches the ledger. The reward is recorded with
 * `creditedAt: null` — actually crediting Wallet C happens in a separate
 * weekly Friday payout sweep (a later ticket), per mlm_rules_log's "granted
 * immediately, reward credited on the next Friday cycle."
 */
export async function evaluateRankForUser(
  userId: string,
  month: string,
  forDate: Date,
): Promise<RankEvaluationResult> {
  const hasActiveInvestment = await prisma.investment.findFirst({
    where: { userId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!hasActiveInvestment) {
    return { granted: false, rank: null };
  }

  const mrvPeriod = await prisma.mrvPeriod.findUnique({ where: { userId_month: { userId, month } } });
  const mrv = mrvPeriod?.volume ?? new Prisma.Decimal(0);

  const referralCount = await qualifiedDirectReferralCount(userId);

  const activeRanks = await prisma.rankConfig.findMany({
    where: { effectiveTo: null },
    orderBy: { rankOrder: "desc" },
  });

  const alreadyAwarded = new Set(
    (await prisma.rankAward.findMany({ where: { userId }, select: { rank: true } })).map((a) => a.rank),
  );
  const alreadyForfeited = new Set(
    (await prisma.rankForfeit.findMany({ where: { userId }, select: { rank: true } })).map((f) => f.rank),
  );
  const alreadyDecided = new Set([...alreadyAwarded, ...alreadyForfeited]);

  const newlyQualified = activeRanks.filter(
    (rankRow) =>
      !alreadyDecided.has(rankRow.rankName) &&
      mrv.gte(rankRow.mrvRequired) &&
      referralCount >= rankRow.directReferralsRequired,
  );

  if (newlyQualified.length === 0) {
    return { granted: false, rank: null };
  }

  // activeRanks is ordered rankOrder desc, so the first newly-qualified
  // entry is the highest; everything else newly-qualified this same month
  // is a lower rank forfeited to it, per mlm_rules_log's "only the highest
  // newly-achieved rank is paid."
  const [highest, ...forfeited] = newlyQualified;

  await prisma.rankAward.create({
    data: {
      userId,
      rank: highest.rankName,
      achievedMonth: month,
      rewardAmount: highest.rewardAmount,
      rewardType: highest.rewardType,
      idempotencyKey: `rank_reward:${userId}:${highest.rankName}`,
    },
  });

  for (const forfeitedRank of forfeited) {
    await prisma.rankForfeit.create({
      data: { userId, rank: forfeitedRank.rankName, forfeitMonth: month },
    });
  }

  return { granted: true, rank: highest.rankName };
}

export type PayQueuedRankRewardsResult = {
  paid: number;
  stillQueued: number;
};

/**
 * Sweeps every RankAward still queued (`creditedAt: null`) and settles what
 * it can: a CASH reward (or a CASH_OR_TRIP award whose user has chosen CASH)
 * credits Wallet C, fully available, no saving split — mirrors Binary
 * Commission's own "new money, not a transfer" ledger shape
 * (docs/mlm_rules_log.md Section 6: "fully available immediately — no
 * 3-month saving split"). A CASH_OR_TRIP award whose user has chosen TRIP is
 * settled with NO ledger entry at all — a logged-only award, per the phase
 * brief. A CASH_OR_TRIP award with no choice recorded yet (`rewardChoice:
 * null`) is left untouched and stays queued — this function never defaults
 * an unmade choice to either option, no matter how many sweeps pass it by.
 *
 * `forDate` is accepted for invariant #4 signature consistency and is
 * stamped as this credit's `purchasedAt`-equivalent moment, but this
 * function does NOT itself gate on "is forDate a Friday" — cadence (calling
 * this only on the actual Friday processing cycle) is the caller's/
 * scheduler's responsibility, matching how binary-cycle-job.ts's cron
 * trigger (not the engine function) owns its own day-of-week gating. Safe
 * to call on any day: it only ever acts on awards that are actually queued,
 * so an off-cycle call is a harmless no-op if nothing is due.
 *
 * Idempotent per award via the award's own stored `idempotencyKey`
 * (`rank_reward:{user_id}:{rank}`) — postTransaction's own replay guard
 * means a second sweep never double-credits, and this function also only
 * ever selects awards still `creditedAt: null` in the first place, so an
 * award already settled (CASH paid or TRIP logged) is never revisited.
 *
 * This is a per-call batch sweep, not a per-user engine function like
 * evaluateRankForUser — there is no natural "per user" unit here since the
 * whole point is sweeping every currently-due award in one pass. A
 * job_runs-tracked catch-up wrapper (if this needs one) is a separate,
 * later concern; this function itself has no periodKey/catch-up state of
 * its own to lose, since re-running it is always safe and cheap (it simply
 * finds nothing to do for already-settled awards).
 */
export async function payQueuedRankRewards(forDate: Date): Promise<PayQueuedRankRewardsResult> {
  const queued = await prisma.rankAward.findMany({ where: { creditedAt: null } });

  let paid = 0;
  let stillQueued = 0;

  for (const award of queued) {
    if (award.rewardType === "CASH_OR_TRIP" && award.rewardChoice === null) {
      stillQueued++;
      continue;
    }

    if (award.rewardType === "CASH_OR_TRIP" && award.rewardChoice === "TRIP") {
      await prisma.rankAward.update({
        where: { id: award.id },
        data: { creditedAt: forDate },
      });
      paid++;
      continue;
    }

    // CASH, or CASH_OR_TRIP with CASH chosen: credit Wallet C.
    await postTransaction({
      entries: [
        {
          userId: award.userId,
          wallet: "C",
          direction: "CREDIT",
          amount: award.rewardAmount,
          entryType: "RANK_REWARD",
          referenceType: "rank_award",
          referenceId: award.id,
          comment: `${award.rank} rank reward.`,
        },
        {
          userId: null,
          wallet: "SYSTEM_EXTERNAL",
          direction: "DEBIT",
          amount: award.rewardAmount,
          entryType: "RANK_REWARD",
          referenceType: "rank_award",
          referenceId: award.id,
          comment: `${award.rank} rank reward.`,
        },
      ],
      idempotencyKey: award.idempotencyKey,
    });

    await prisma.rankAward.update({
      where: { id: award.id },
      data: { creditedAt: forDate },
    });
    paid++;
  }

  return { paid, stillQueued };
}

export type RankProgress = {
  /** Highest-rankOrder rank ever granted, or null if the user has none yet. */
  currentRank: { name: string; rankOrder: number } | null;
  /**
   * The next active rank to progress toward — the lowest active rankOrder
   * strictly greater than currentRank's (or the lowest active rank at all,
   * for an unranked user). Null only when currentRank is already the highest
   * active rankOrder (the top/OG rank) — there is nothing higher to show
   * progress toward.
   */
  nextRank: {
    name: string;
    mrvRequired: Prisma.Decimal;
    directReferralsRequired: number;
  } | null;
  /** Current calendar month's MRV (Asia/Dubai), 0 if no mrv_periods row yet. */
  currentMrv: Prisma.Decimal;
  /** Live count, same definition as qualifiedDirectReferralCount. */
  currentReferralCount: number;
};

/**
 * Everything a dashboard "rank progress" panel needs to render: the user's
 * current permanent rank (from rank_awards — never a live re-evaluation,
 * since ranks are permanent per invariant #6 and this must reflect what was
 * actually granted, not what today's numbers alone would qualify for), the
 * next active rank to progress toward, and this month's live MRV/referral
 * numbers to compare against that next rank's thresholds.
 *
 * A user with no rank_awards row yet has `currentRank: null` ("Unranked", not
 * an error) and `nextRank` is the lowest-rankOrder active rank (Investor,
 * currently) — everyone's first rank to work toward. A user already at the
 * highest active rankOrder (OG, currently) has `nextRank: null` — the
 * caller must render a "max rank achieved" state, not divide by a
 * nonexistent threshold.
 *
 * `currentMrv`/`currentReferralCount` are always the LIVE current-month/
 * current-moment values (never the month currentRank was actually granted
 * in) — they exist purely to show progress toward `nextRank`, which by
 * definition has not been granted yet, so there is no historical snapshot to
 * read instead.
 */
export async function getRankProgressForUser(userId: string, forDate: Date): Promise<RankProgress> {
  const activeRanks = await prisma.rankConfig.findMany({
    where: { effectiveTo: null },
    orderBy: { rankOrder: "asc" },
  });

  const awards = await prisma.rankAward.findMany({ where: { userId } });
  const awardedRankNames = new Set(awards.map((a) => a.rank));
  const awardedActiveRanks = activeRanks.filter((r) => awardedRankNames.has(r.rankName));
  const highestAwarded =
    awardedActiveRanks.length > 0
      ? awardedActiveRanks.reduce((a, b) => (b.rankOrder > a.rankOrder ? b : a))
      : null;

  const currentRank = highestAwarded ? { name: highestAwarded.rankName, rankOrder: highestAwarded.rankOrder } : null;

  const nextRankRow = activeRanks.find((r) => r.rankOrder > (currentRank?.rankOrder ?? -Infinity)) ?? null;
  const nextRank = nextRankRow
    ? {
        name: nextRankRow.rankName,
        mrvRequired: nextRankRow.mrvRequired,
        directReferralsRequired: nextRankRow.directReferralsRequired,
      }
    : null;

  const month = dubaiMonthKey(forDate);
  const mrvPeriod = await prisma.mrvPeriod.findUnique({ where: { userId_month: { userId, month } } });
  const currentMrv = mrvPeriod?.volume ?? new Prisma.Decimal(0);

  const currentReferralCount = await qualifiedDirectReferralCount(userId);

  return { currentRank, nextRank, currentMrv, currentReferralCount };
}

async function assertHasRankConfigPermission(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }
  if (admin.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "RANK_CONFIG" } },
  });
  if (!grant) {
    throw new Error("Forbidden: missing RANK_CONFIG permission.");
  }
}

const editRankConfigInputSchema = z.object({
  rankName: z.string().min(1),
  mrvRequired: z.string().or(z.number()).optional(),
  directReferralsRequired: z.number().int().positive().optional(),
  rewardAmount: z.string().or(z.number()).optional(),
  rewardType: z.enum(["CASH", "CASH_OR_TRIP"]).optional(),
  forDate: z.date(),
});

export type EditRankConfigInput = z.infer<typeof editRankConfigInputSchema>;

export class RankAlreadyAchievedError extends Error {
  constructor(rankName: string) {
    super(`Rank "${rankName}" has already been achieved by at least one user and cannot be edited.`);
    this.name = "RankAlreadyAchievedError";
  }
}

/**
 * Admin edit of an existing rank's threshold/reward — MRV requirement,
 * referral count, and/or reward amount/type. Requires RANK_CONFIG (main
 * admin bypasses, per invariant #8 / the established requirePermission
 * pattern used by requirePermission/assertHasUserManagementPermission/
 * requirePackageManagement elsewhere in this codebase).
 *
 * Versioned exactly like interest_rate_config/commission_config (Decision
 * 4): NEVER mutates the existing active row in place. Closes the current
 * active row for this rankName (`effectiveTo: forDate`) and inserts a new
 * row starting at `forDate` with the edited fields, carrying over every
 * field the caller didn't specify from the row being closed (rankOrder
 * included — changing a rank's position in the order is not this
 * function's job, only its thresholds/reward). This versioning alone is
 * what makes an edit never retroactive to an already-granted award or an
 * already-evaluated month: every money-relevant reader already only ever
 * queries `effectiveTo: null` (evaluateRankForUser) or reads a value
 * snapshotted at grant time onto RankAward itself (payQueuedRankRewards) —
 * neither ever re-reads a historical rank_config row.
 *
 * SCRUM-110 layers a STRICTER admin-facing rule on top of that: refuses the
 * edit outright (RankAlreadyAchievedError, nothing written) the moment ANY
 * user has ever been granted this rank (a `rank_awards` row exists for
 * `rankName`), even though the versioning above would make the edit safe
 * regardless. This is a deliberate UX/business-rule restriction, not a
 * correctness fix — the admin panel's "flag it clearly" requirement is
 * enforced here as a hard refusal rather than a warning-only affordance.
 *
 * `forDate` is an explicit param (invariant #4), used both as the new
 * row's `effectiveFrom` and the closed row's `effectiveTo`.
 */
export async function editRankConfig(actingAdminId: string, input: EditRankConfigInput) {
  const data = editRankConfigInputSchema.parse(input);
  await assertHasRankConfigPermission(actingAdminId);

  const current = await prisma.rankConfig.findFirst({
    where: { rankName: data.rankName, effectiveTo: null },
  });
  if (!current) {
    throw new Error(`No active rank_config row found for rank "${data.rankName}".`);
  }

  const alreadyAchieved = await prisma.rankAward.findFirst({ where: { rank: data.rankName } });
  if (alreadyAchieved) {
    throw new RankAlreadyAchievedError(data.rankName);
  }

  return prisma.$transaction(async (tx) => {
    await tx.rankConfig.update({
      where: { id: current.id },
      data: { effectiveTo: data.forDate },
    });

    const updated = await tx.rankConfig.create({
      data: {
        rankName: current.rankName,
        mrvRequired: data.mrvRequired ?? current.mrvRequired,
        directReferralsRequired: data.directReferralsRequired ?? current.directReferralsRequired,
        rewardAmount: data.rewardAmount ?? current.rewardAmount,
        rewardType: (data.rewardType as RankRewardType | undefined) ?? current.rewardType,
        rankOrder: current.rankOrder,
        effectiveFrom: data.forDate,
        effectiveTo: null,
        setByAdminId: actingAdminId,
      },
    });

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "RANK_CONFIG_EDITED",
        amount: data.rewardAmount ?? undefined,
        reason: `Edited rank "${data.rankName}": mrvRequired=${updated.mrvRequired.toString()}, directReferralsRequired=${updated.directReferralsRequired}, rewardAmount=${updated.rewardAmount.toString()}, rewardType=${updated.rewardType}.`,
      },
    });

    return updated;
  });
}

const createRankConfigInputSchema = z.object({
  rankName: z.string().min(1),
  mrvRequired: z.string().or(z.number()),
  directReferralsRequired: z.number().int().positive(),
  rewardAmount: z.string().or(z.number()),
  rewardType: z.enum(["CASH", "CASH_OR_TRIP"]),
  rankOrder: z.number().int().optional(),
  forDate: z.date(),
});

export type CreateRankConfigInput = z.infer<typeof createRankConfigInputSchema>;

export class RankOrderTooLowError extends Error {
  constructor(rankOrder: number, highestExisting: number) {
    super(
      `A new rank's rankOrder (${rankOrder}) must be strictly above the current highest rank's (${highestExisting}) — new ranks can only be added above the top of the existing hierarchy.`,
    );
    this.name = "RankOrderTooLowError";
  }
}

/**
 * Admin creation of a brand-new rank (e.g. adding a rank above OG).
 * Requires RANK_CONFIG. Simply inserts a new active row — there is no
 * prior row to close since this rank has never existed.
 *
 * `rankOrder` is optional: when omitted (the admin panel's default path),
 * it's auto-computed as `1 + the current highest active rank's rankOrder`
 * — this makes "new ranks only go above the top" structural rather than
 * merely server-validated, per SCRUM-110. When the caller does specify a
 * `rankOrder` explicitly (e.g. a future non-UI caller), it's still
 * validated to be strictly greater than every currently-active rank's
 * rankOrder (RankOrderTooLowError, nothing written, otherwise) — SCRUM-108/
 * 109's docs constraint ("only allowed above OG, the highest existing
 * rank") applied generally rather than hardcoding the literal name "OG",
 * since a future ticket could itself add a rank above OG, at which point
 * that new rank — not OG — is the real ceiling.
 *
 * `rankName` collides with an existing rank's `rank_config_one_active_per_
 * rank` partial unique index if one is already active under the same name
 * — this function does not pre-check for that, relying on the DB
 * constraint as the backstop (same "trust the constraint" posture as
 * other create paths in this codebase, e.g. Package.name's own @unique).
 */
export async function createRankConfig(actingAdminId: string, input: CreateRankConfigInput) {
  const data = createRankConfigInputSchema.parse(input);
  await assertHasRankConfigPermission(actingAdminId);

  const highestActive = await prisma.rankConfig.findFirst({
    where: { effectiveTo: null },
    orderBy: { rankOrder: "desc" },
  });
  const highestExistingOrder = highestActive?.rankOrder ?? 0;

  const rankOrder = data.rankOrder ?? highestExistingOrder + 1;
  if (rankOrder <= highestExistingOrder) {
    throw new RankOrderTooLowError(rankOrder, highestExistingOrder);
  }

  return prisma.$transaction(async (tx) => {
    const created = await tx.rankConfig.create({
      data: {
        rankName: data.rankName,
        mrvRequired: data.mrvRequired,
        directReferralsRequired: data.directReferralsRequired,
        rewardAmount: data.rewardAmount,
        rewardType: data.rewardType,
        rankOrder,
        effectiveFrom: data.forDate,
        effectiveTo: null,
        setByAdminId: actingAdminId,
      },
    });

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "RANK_CONFIG_CREATED",
        amount: data.rewardAmount,
        reason: `Created rank "${data.rankName}": mrvRequired=${created.mrvRequired.toString()}, directReferralsRequired=${created.directReferralsRequired}, rewardAmount=${created.rewardAmount.toString()}, rewardType=${created.rewardType}, rankOrder=${created.rankOrder}.`,
      },
    });

    return created;
  });
}

/**
 * A user records their own CASH-vs-TRIP choice on a pending CASH_OR_TRIP
 * rank award (Partner, currently the only CASH_OR_TRIP rank). Ownership is
 * enforced by construction — `userId` is the only filter used to find the
 * award, never a client-supplied award/user id combination trusted alone
 * (invariant #9); a user with no award of their own for `rank` gets the
 * same "not found" outcome as a genuinely never-granted rank, never a leak
 * about whether some OTHER user holds that award.
 *
 * Rejects if:
 * - No award exists for this user+rank at all (never granted).
 * - The award's `rewardType` isn't CASH_OR_TRIP (nothing to choose for a
 *   plain CASH rank — Investor, Executive, etc.).
 * - A choice was already recorded (`rewardChoice` is not null) — once
 *   made, the choice is permanent; this does not silently overwrite it.
 *
 * Does not touch `creditedAt` or the ledger — this only records the
 * choice. `payQueuedRankRewards` (SCRUM-86) is what reads `rewardChoice`
 * at the next sweep and actually settles the award accordingly.
 */
export async function chooseRankReward(userId: string, rank: string, choice: "CASH" | "TRIP") {
  const award = await prisma.rankAward.findUnique({
    where: { userId_rank: { userId, rank } },
  });
  if (!award) {
    throw new Error(`No rank award found for this user and rank "${rank}".`);
  }
  if (award.rewardType !== "CASH_OR_TRIP") {
    throw new Error(`Rank "${rank}" is not a CASH_OR_TRIP reward — there is no choice to make.`);
  }
  if (award.rewardChoice !== null) {
    throw new Error(`A reward choice has already been made for rank "${rank}".`);
  }

  return prisma.rankAward.update({
    where: { id: award.id },
    data: { rewardChoice: choice },
  });
}

export type RankConfigListRow = {
  id: string;
  rankName: string;
  mrvRequired: Prisma.Decimal;
  directReferralsRequired: number;
  rewardAmount: Prisma.Decimal;
  rewardType: RankRewardType;
  rankOrder: number;
  effectiveFrom: Date;
  /** Whether at least one user has ever been granted this rank — the admin
   * panel's "flag it clearly, can't edit" signal (SCRUM-110). */
  achievedByAnyUser: boolean;
  setByAdminName: string | null;
};

/**
 * All currently-active ranks (`effectiveTo: null`, one per rankName by
 * construction — the partial unique index), ordered by rankOrder ascending
 * — the admin panel's rank list. RANK_CONFIG-gated (main admin bypass);
 * this is admin-facing config data, not user-owned, so invariant #9's
 * self-ownership rule doesn't apply.
 *
 * Annotates each row with `achievedByAnyUser` so the UI can grey out /
 * block the edit action before the admin even tries and hits
 * RankAlreadyAchievedError — computed via a single `groupBy` over
 * rank_awards rather than one query per rank, since the rank list is small
 * but this avoids N+1 regardless.
 */
export async function listRankConfigs(actingAdminId: string): Promise<RankConfigListRow[]> {
  await assertHasRankConfigPermission(actingAdminId);

  const [activeRanks, achievedGroups] = await Promise.all([
    prisma.rankConfig.findMany({
      where: { effectiveTo: null },
      orderBy: { rankOrder: "asc" },
      include: { setByAdmin: { select: { name: true } } },
    }),
    prisma.rankAward.groupBy({ by: ["rank"] }),
  ]);

  const achievedRankNames = new Set(achievedGroups.map((g) => g.rank));

  return activeRanks.map((r) => ({
    id: r.id,
    rankName: r.rankName,
    mrvRequired: r.mrvRequired,
    directReferralsRequired: r.directReferralsRequired,
    rewardAmount: r.rewardAmount,
    rewardType: r.rewardType,
    rankOrder: r.rankOrder,
    effectiveFrom: r.effectiveFrom,
    achievedByAnyUser: achievedRankNames.has(r.rankName),
    setByAdminName: r.setByAdmin?.name ?? null,
  }));
}

export type RankConfigHistoryRow = {
  id: string;
  rankName: string;
  mrvRequired: Prisma.Decimal;
  directReferralsRequired: number;
  rewardAmount: Prisma.Decimal;
  rewardType: RankRewardType;
  rankOrder: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  setByAdminName: string | null;
  createdAt: Date;
};

/**
 * Full version history across every rank (or just one, if `rankName` is
 * given), newest effectiveFrom first — the admin panel's history view.
 * RANK_CONFIG-gated (main admin bypass).
 */
export async function listRankConfigHistory(
  actingAdminId: string,
  rankName?: string,
): Promise<RankConfigHistoryRow[]> {
  await assertHasRankConfigPermission(actingAdminId);

  const rows = await prisma.rankConfig.findMany({
    where: rankName ? { rankName } : undefined,
    orderBy: { effectiveFrom: "desc" },
    include: { setByAdmin: { select: { name: true } } },
  });

  return rows.map((r) => ({
    id: r.id,
    rankName: r.rankName,
    mrvRequired: r.mrvRequired,
    directReferralsRequired: r.directReferralsRequired,
    rewardAmount: r.rewardAmount,
    rewardType: r.rewardType,
    rankOrder: r.rankOrder,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    setByAdminName: r.setByAdmin?.name ?? null,
    createdAt: r.createdAt,
  }));
}
