import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { DEVELOPER_TOOLS_SETTINGS_ID } from "./developer-tools-constants";
import { listJobStatuses, triggerJobRun } from "./job-monitor";
import { accrueDailyInterestForInvestment } from "./daily-interest";

async function assertHasDeveloperToolsPermission(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }
  if (admin.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "DEVELOPER_TOOLS" } },
  });
  if (!grant) {
    throw new Error("Forbidden: missing DEVELOPER_TOOLS permission.");
  }
}

export type FridayBypassStatus = {
  enabled: boolean;
  updatedAt: Date;
  updatedByAdminName: string | null;
};

/**
 * Current state of the Friday-withdrawal-gate testing bypass — the same
 * singleton row `assertFriday` (withdrawal-guard.ts) itself reads. Read-only,
 * DEVELOPER_TOOLS-gated.
 */
export async function getFridayBypassStatus(actingAdminId: string): Promise<FridayBypassStatus> {
  await assertHasDeveloperToolsPermission(actingAdminId);

  const settings = await prisma.developerToolsSetting.findUniqueOrThrow({
    where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
    include: { updatedByAdmin: { select: { name: true } } },
  });

  return {
    enabled: settings.bypassFridayGate,
    updatedAt: settings.updatedAt,
    updatedByAdminName: settings.updatedByAdmin?.name ?? null,
  };
}

/**
 * Toggles the Friday-withdrawal-gate testing bypass. DEVELOPER_TOOLS-gated.
 * Logs `FRIDAY_GATE_BYPASS_TOGGLED` to admin_actions so turning this on/off
 * is attributable and auditable — this flag controls a real production
 * financial safety gate (A->B profit transfer, capital release, and B-exit
 * submission all skip their Friday check while it's on), not a cosmetic
 * setting.
 *
 * No `forDate` parameter (unlike most admin actions in this codebase):
 * there is no business-meaningful date this function writes — `updatedAt`
 * is `@updatedAt`-tracked by Prisma itself, and `admin_actions.createdAt`
 * defaults to `now()` like every other admin-action log call site in this
 * codebase (none of them pass a caller-supplied date either). Matches
 * `reinstateUser`'s signature in users.ts, which drops `forDate` for the
 * same reason (no field to set from it) while `suspendUser` keeps it
 * (writes `suspendedAt: forDate`).
 */
export async function setFridayBypass(actingAdminId: string, enabled: boolean): Promise<void> {
  await assertHasDeveloperToolsPermission(actingAdminId);

  await prisma.$transaction([
    prisma.developerToolsSetting.update({
      where: { id: DEVELOPER_TOOLS_SETTINGS_ID },
      data: { bypassFridayGate: enabled, updatedByAdminId: actingAdminId },
    }),
    prisma.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "FRIDAY_GATE_BYPASS_TOGGLED",
        reason: `Friday withdrawal gate testing bypass turned ${enabled ? "ON" : "OFF"}.`,
      },
    }),
  ]);
}

/**
 * The Developer Tools page's job-trigger section is a consumer of
 * job-monitor.ts, not a fork of it — same JOB_MONITOR permission check,
 * same catch-up functions the real cron worker calls, same audit log
 * entry type (JOB_MONITOR_TRIGGERED). Re-exported here so the page's own
 * actions.ts has one import surface for everything Developer Tools needs,
 * without duplicating job-monitor.ts's logic.
 */
export { listJobStatuses, triggerJobRun };

export class InvestmentNotFoundError extends Error {
  constructor() {
    super("No investment found with that id.");
    this.name = "InvestmentNotFoundError";
  }
}

export class InvalidSimulationDaysError extends Error {
  constructor() {
    super("Days must be a whole number between 1 and 30.");
    this.name = "InvalidSimulationDaysError";
  }
}

export class SimulationWouldExceedTodayError extends Error {
  constructor() {
    super("This simulation would post dates beyond today — reduce the number of days.");
    this.name = "SimulationWouldExceedTodayError";
  }
}

export type SimulationInvestmentSummary = {
  id: string;
  ownerName: string;
  ownerEmail: string;
  packageName: string;
  amount: Prisma.Decimal;
  status: "ACTIVE" | "CAPITAL_RELEASED";
  purchasedAt: Date;
  profitStartsAt: Date;
};

/**
 * Looks up a single investment by id for the simulate-daily-interest UI's
 * "confirm before you fire this" step — shows the admin exactly whose
 * investment they're about to post real (if backdated) interest for,
 * before any ledger write happens. Read-only, DEVELOPER_TOOLS-gated.
 *
 * Called once an admin has picked one specific investment from the
 * search-then-list flow (`listActiveInvestmentsForSimulation` below) —
 * the investment id itself is never surfaced to or typed by the admin;
 * it only ever travels as an internal id from a list-row click straight
 * into this lookup and then into `simulateDailyInterestDays`.
 */
export async function findInvestmentForSimulation(
  actingAdminId: string,
  investmentId: string,
): Promise<SimulationInvestmentSummary> {
  await assertHasDeveloperToolsPermission(actingAdminId);

  const investment = await prisma.investment.findUnique({
    where: { id: investmentId },
    include: { user: { select: { name: true, email: true } }, package: { select: { name: true } } },
  });
  if (!investment) {
    throw new InvestmentNotFoundError();
  }

  return {
    id: investment.id,
    ownerName: investment.user.name,
    ownerEmail: investment.user.email,
    packageName: investment.package.name,
    amount: investment.amount,
    status: investment.status,
    purchasedAt: investment.purchasedAt,
    profitStartsAt: investment.profitStartsAt,
  };
}

export type SimulationInvestmentListRow = {
  id: string;
  packageName: string;
  amount: Prisma.Decimal;
  purchasedAt: Date;
  status: "ACTIVE" | "CAPITAL_RELEASED";
};

/**
 * A target user's ACTIVE investments, for the Developer Tools user-search
 * -then-pick-an-investment flow's second step. Deliberately admin-facing
 * (actingAdminId + targetUserId, permission-checked first, queries prisma
 * directly) rather than reusing `listActiveInvestmentsForUser` in
 * investments.ts — that function is explicitly self-service-only by its
 * own doc comment ("ownership enforced by construction... no separate
 * target-user param exists to view someone else's investments,
 * invariant #9"); calling it with an admin-supplied target id would be
 * exactly the IDOR bypass invariant #9 exists to prevent. Mirrors
 * getUserDetail's shape in user-management.ts for the same reason.
 *
 * Scoped to ACTIVE only, not the user's full investment history — a
 * CAPITAL_RELEASED investment can't usefully simulate interest on anyway
 * (`accrueDailyInterestForInvestment` checks `investment.status` itself
 * and immediately skips a released one for every simulated day), so
 * listing it here would only offer a selection guaranteed to post zero
 * entries.
 */
export async function listActiveInvestmentsForSimulation(
  actingAdminId: string,
  targetUserId: string,
): Promise<SimulationInvestmentListRow[]> {
  await assertHasDeveloperToolsPermission(actingAdminId);

  const investments = await prisma.investment.findMany({
    where: { userId: targetUserId, status: "ACTIVE" },
    include: { package: { select: { name: true } } },
    orderBy: { purchasedAt: "desc" },
  });

  return investments.map((investment) => ({
    id: investment.id,
    packageName: investment.package.name,
    amount: investment.amount,
    purchasedAt: investment.purchasedAt,
    status: investment.status,
  }));
}

export type SimulateDailyInterestResult = {
  daysProcessed: number;
  entriesPosted: number;
  totalCredited: Prisma.Decimal;
  simulatedFrom: Date;
  simulatedTo: Date;
};

const MIN_SIMULATION_DAYS = 1;
const MAX_SIMULATION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const PROFIT_START_WAIT_DAYS = 8;

/**
 * Finds the calendar date to start injecting simulated days from: the day
 * after this investment's latest existing DAILY_INTEREST credit, or
 * `purchasedAt + 8 days` (one day after the 7-day wait `profitStartsAt`
 * itself encodes) if no DAILY_INTEREST entry exists yet.
 *
 * The simulated date isn't stored as its own column anywhere — only encoded
 * in the idempotency key's trailing `YYYY-MM-DD` (see
 * `accrueDailyInterestForInvestment`'s own comment on this being a stable
 * contract). Reading `createdAt` instead would be wrong: for a backdated
 * simulation, `createdAt` is the real wall-clock time the row was written,
 * not the fabricated date it represents. Parsing every matching key and
 * taking the lexicographic max is safe here since the format is a
 * zero-padded `YYYY-MM-DD` suffix, which sorts the same lexicographically
 * and chronologically.
 */
async function findNextSimulationStartDate(investment: {
  id: string;
  userId: string;
  purchasedAt: Date;
}): Promise<Date> {
  const priorEntries = await prisma.ledgerEntry.findMany({
    where: {
      referenceType: "investment",
      referenceId: investment.id,
      entryType: "DAILY_INTEREST",
      wallet: "A",
      direction: "CREDIT",
    },
    select: { idempotencyKey: true },
  });

  const keyPrefix = `daily_interest:${investment.userId}:${investment.id}:`;
  let latestDateKey: string | null = null;
  for (const entry of priorEntries) {
    if (!entry.idempotencyKey.startsWith(keyPrefix)) continue;
    const dateKey = entry.idempotencyKey.slice(keyPrefix.length);
    if (latestDateKey === null || dateKey > latestDateKey) {
      latestDateKey = dateKey;
    }
  }

  if (latestDateKey === null) {
    return new Date(investment.purchasedAt.getTime() + PROFIT_START_WAIT_DAYS * MS_PER_DAY);
  }
  return new Date(new Date(`${latestDateKey}T00:00:00.000Z`).getTime() + MS_PER_DAY);
}

/**
 * "Simulate N days of Daily Interest" — Developer Tools' production
 * -health-testing feature for exercising the REAL accrual function
 * (`accrueDailyInterestForInvestment`, the exact same one the daily cron
 * calls) against real compounding/rate/Friday-skip behavior, without
 * waiting N real days for it to happen.
 *
 * Deliberately scoped to ONE admin-chosen investment, never every ACTIVE
 * investment platform-wide — the real scheduled job
 * (runDailyInterestCatchUp in daily-interest-job.ts) loops over every
 * active investment for each day it processes; doing the same here with
 * fabricated dates would post real, permanent, irreversible interest
 * credits (ledger_entries is append-only, invariant #2) to every real
 * user's real Wallet A, N extra times. That exact class of mistake
 * corrupted a real user's balance to ~511M in an earlier phase (SCRUM-54,
 * see tasks/lessons.md) when a fabricated-date test run swept in
 * pre-existing real investments — confirmed with the project owner that
 * this feature must target a single explicitly-chosen investment instead.
 *
 * The injected date range always starts the day AFTER this investment's
 * latest existing DAILY_INTEREST entry (or `purchasedAt + 8 days` if it has
 * none yet) — see `findNextSimulationStartDate` — never anchored to
 * `today`. An earlier version anchored day N to `today` regardless of what
 * had already been posted, so re-running the simulation (or running it
 * against an investment the real daily cron had already caught up to
 * today) always collided with existing idempotency keys and silently
 * posted zero entries. Iterates oldest-to-newest from that start date,
 * calling the real per-investment accrual function for each date in
 * order — required so day 2's running-balance read sees day 1's credit
 * already posted (real compounding), not just N independent single-day
 * calls. Each date is naturally a distinct idempotency key
 * (accrueDailyInterestForInvestment's own key embeds the calendar date),
 * so no separate uniqueness handling is needed here — this was already
 * true of the real function before this feature existed.
 *
 * `entriesPosted`/`totalCredited` only count days that actually posted a
 * NEW credit — a day the real function itself skips (Friday, before the
 * investment's own profit-start date, capital already released, owner
 * suspended) or that was already processed (replay) contributes 0 to
 * both, exactly mirroring what the real ledger ends up containing.
 * `totalCredited` sums the ACTUAL PERSISTED ledger amounts (re-read after
 * each post), not `accrueDailyInterestForInvestment`'s returned in-memory
 * value — that value is computed before the `NUMERIC(24,8)` column's own
 * rounding-on-write, so summing it directly can drift from what the
 * ledger actually contains at high decimal precision (same rounding
 * -boundary class of issue as the SCRUM-54 mistake #3 lesson in
 * tasks/lessons.md: a persisted fixed-precision column must be read back
 * post-rounding to match, not trusted from its own pre-write calculation).
 *
 * DEVELOPER_TOOLS-gated. Logs `DAILY_INTEREST_SIMULATED` to admin_actions
 * — this writes real ledger entries for a real user, so it needs the same
 * attributability as any other financial admin action (invariant #8),
 * arguably more so given the backdated-date nature of what it does.
 *
 * Takes `today` ONLY as an upper bound (invariant #4: caller-supplied, never
 * `new Date()` internally) — it never affects where the range STARTS (that
 * stays entirely determined by this investment's own ledger history, see
 * `findNextSimulationStartDate`), only whether the computed END date is
 * allowed. Added after a real incident: nothing previously stopped repeated
 * clicks from chaining forward past the real current date — three manual
 * 30-day simulations in a row (each one correctly continuing from where the
 * last one left off, by design) pushed one investment's ledger 90 days into
 * the future, meaning the real daily cron then found every date through
 * that point "already processed" and posted nothing for three months,
 * which is exactly the "no new profit entries" symptom that gets reported
 * as a scheduler bug when it is actually this tool having no upper bound.
 * Refuses outright (nothing written) rather than silently truncating `days`
 * — a silent truncation would make the admin's "N days" input lie about
 * what actually got simulated.
 */
export async function simulateDailyInterestDays(
  actingAdminId: string,
  investmentId: string,
  days: number,
  today: Date,
): Promise<SimulateDailyInterestResult> {
  await assertHasDeveloperToolsPermission(actingAdminId);

  if (!Number.isInteger(days) || days < MIN_SIMULATION_DAYS || days > MAX_SIMULATION_DAYS) {
    throw new InvalidSimulationDaysError();
  }

  const investment = await prisma.investment.findUnique({ where: { id: investmentId } });
  if (!investment) {
    throw new InvestmentNotFoundError();
  }

  const startDate = await findNextSimulationStartDate(investment);
  const endDate = new Date(startDate.getTime() + (days - 1) * MS_PER_DAY);

  if (endDate > today) {
    throw new SimulationWouldExceedTodayError();
  }

  let entriesPosted = 0;
  let totalCredited = new Prisma.Decimal(0);

  for (let i = 0; i < days; i++) {
    const simulatedDate = new Date(startDate.getTime() + i * MS_PER_DAY);

    const result = await accrueDailyInterestForInvestment(investmentId, simulatedDate);
    if (!result.skipped && !result.alreadyProcessed) {
      entriesPosted++;
      // Re-read the actual persisted (rounded) amount rather than trusting
      // `result.amount` — see this function's own doc comment above for why.
      // This exact idempotency-key format (`daily_interest:{userId}:
      // {investmentId}:{YYYY-MM-DD}`) is already relied on verbatim by
      // daily-interest.test.ts, daily-interest-job.test.ts, and
      // phase-4-exit-test.test.ts — a stable, effectively-public contract
      // of accrueDailyInterestForInvestment, not a fragile guess at its
      // internals.
      const dateKey = simulatedDate.toISOString().slice(0, 10);
      const postedEntry = await prisma.ledgerEntry.findFirstOrThrow({
        where: {
          idempotencyKey: `daily_interest:${investment.userId}:${investmentId}:${dateKey}`,
          wallet: "A",
          direction: "CREDIT",
        },
      });
      totalCredited = totalCredited.add(postedEntry.amount);
    }
  }

  const startDateKey = startDate.toISOString().slice(0, 10);
  const endDateKey = endDate.toISOString().slice(0, 10);

  await prisma.adminAction.create({
    data: {
      adminId: actingAdminId,
      actionType: "DAILY_INTEREST_SIMULATED",
      targetUserId: investment.userId,
      reason: `Simulated ${days} day(s) of Daily Interest for investment ${investmentId} (${startDateKey} to ${endDateKey}, testing only, artificial dates).`,
    },
  });

  return { daysProcessed: days, entriesPosted, totalCredited, simulatedFrom: startDate, simulatedTo: endDate };
}
