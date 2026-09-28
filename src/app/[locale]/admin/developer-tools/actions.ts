"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/route-guard";
import {
  getFridayBypassStatus,
  setFridayBypass,
  listJobStatuses,
  triggerJobRun,
  findInvestmentForSimulation,
  listActiveInvestmentsForSimulation,
  simulateDailyInterestDays,
  InvestmentNotFoundError,
  InvalidSimulationDaysError,
} from "@/lib/developer-tools";
import { searchUsers } from "@/lib/user-management";
import { UnknownJobTypeError, type JobType } from "@/lib/job-monitor";
import { toDisplay } from "@/lib/display";

export type DeveloperToolsErrorKey =
  | "errorUnknownJob"
  | "errorForbidden"
  | "errorInvestmentNotFound"
  | "errorInvalidDays"
  | "errorGeneric";

function mapError(err: unknown): DeveloperToolsErrorKey {
  if (err instanceof UnknownJobTypeError) return "errorUnknownJob";
  if (err instanceof InvestmentNotFoundError) return "errorInvestmentNotFound";
  if (err instanceof InvalidSimulationDaysError) return "errorInvalidDays";
  if (err instanceof Error && /forbidden/i.test(err.message)) return "errorForbidden";
  return "errorGeneric";
}

export type JobStatusRow = {
  jobType: JobType;
  currentStatus: "RUNNING" | "COMPLETED" | "FAILED" | "NEVER_RUN";
  lastCompletedPeriodKey: string | null;
  lastCompletedAt: string | null;
  lastFailedPeriodKey: string | null;
  lastFailedAt: string | null;
  lastFailedError: string | null;
};

export type JobStatusListResult = { ok: true; jobs: JobStatusRow[] } | { ok: false; errorKey: DeveloperToolsErrorKey };

export async function listJobStatusesAction(): Promise<JobStatusListResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
    const jobs = await listJobStatuses(actor.id);
    return {
      ok: true,
      jobs: jobs.map((j) => ({
        jobType: j.jobType,
        currentStatus: j.currentStatus,
        lastCompletedPeriodKey: j.lastCompletedPeriodKey,
        lastCompletedAt: j.lastCompletedAt?.toISOString() ?? null,
        lastFailedPeriodKey: j.lastFailedPeriodKey,
        lastFailedAt: j.lastFailedAt?.toISOString() ?? null,
        lastFailedError: j.lastFailedError,
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type TriggerJobResult = { ok: true } | { ok: false; errorKey: DeveloperToolsErrorKey };

/**
 * Calls requirePermission("DEVELOPER_TOOLS", ...) first — the real
 * server-side enforcement point (invariant #8) — before job-monitor.ts's
 * own inline JOB_MONITOR re-check runs inside triggerJobRun. Both
 * permissions gate this one action deliberately: a sub-admin needs
 * DEVELOPER_TOOLS to reach this screen at all, and triggerJobRun itself
 * still independently enforces JOB_MONITOR (defense in depth, same as
 * every other lib function that re-checks its own permission regardless
 * of what called it).
 */
export async function triggerJobRunAction(jobType: string, locale: string): Promise<TriggerJobResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
    await triggerJobRun(actor.id, jobType, new Date());
    revalidatePath(`/${locale}/admin/developer-tools`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type FridayBypassStatusRow = {
  enabled: boolean;
  updatedAt: string;
  updatedByAdminName: string | null;
};

export type FridayBypassStatusResult =
  | { ok: true; status: FridayBypassStatusRow }
  | { ok: false; errorKey: DeveloperToolsErrorKey };

export async function getFridayBypassStatusAction(): Promise<FridayBypassStatusResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
    const status = await getFridayBypassStatus(actor.id);
    return {
      ok: true,
      status: {
        enabled: status.enabled,
        updatedAt: status.updatedAt.toISOString(),
        updatedByAdminName: status.updatedByAdminName,
      },
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type SetFridayBypassResult = { ok: true } | { ok: false; errorKey: DeveloperToolsErrorKey };

export async function setFridayBypassAction(enabled: boolean, locale: string): Promise<SetFridayBypassResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
    await setFridayBypass(actor.id, enabled);
    revalidatePath(`/${locale}/admin/developer-tools`);
    return { ok: true };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type SimulationUserOption = { id: string; name: string; email: string };

export type SearchUsersForSimulationResult =
  | { ok: true; users: SimulationUserOption[] }
  | { ok: false; errorKey: DeveloperToolsErrorKey };

/**
 * Step 1 of the "Simulate Daily Interest" user-search-then-pick-an
 * -investment flow — never surfaces a raw investment id, only enough to
 * pick a user by name/email. Calls requirePermission("DEVELOPER_TOOLS", ...)
 * first (invariant #8) before searchUsers' own inline re-check, same
 * defense-in-depth pattern as every other action on this page.
 */
export async function searchUsersForSimulationAction(query: string): Promise<SearchUsersForSimulationResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
    const result = await searchUsers(actor.id, { query });
    return { ok: true, users: result.users.map((u) => ({ id: u.id, name: u.name, email: u.email })) };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type SimulationInvestmentListRow = {
  id: string;
  packageName: string;
  amount: string;
  purchasedAt: string;
  status: "ACTIVE" | "CAPITAL_RELEASED";
};

export type ListInvestmentsForSimulationResult =
  | { ok: true; investments: SimulationInvestmentListRow[] }
  | { ok: false; errorKey: DeveloperToolsErrorKey };

/** Step 2: the selected user's ACTIVE investments to choose from. */
export async function listActiveInvestmentsForSimulationAction(
  userId: string,
): Promise<ListInvestmentsForSimulationResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
    const investments = await listActiveInvestmentsForSimulation(actor.id, userId);
    return {
      ok: true,
      investments: investments.map((i) => ({
        id: i.id,
        packageName: i.packageName,
        amount: toDisplay(i.amount),
        purchasedAt: i.purchasedAt.toISOString(),
        status: i.status,
      })),
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type SimulationInvestmentRow = {
  id: string;
  ownerName: string;
  ownerEmail: string;
  packageName: string;
  amount: string;
  status: "ACTIVE" | "CAPITAL_RELEASED";
};

export type LookupInvestmentResult =
  | { ok: true; investment: SimulationInvestmentRow }
  | { ok: false; errorKey: DeveloperToolsErrorKey };

/** Step 3: once a specific investment row is picked, get its full confirm
 * -step summary (owner name/email, package, amount, status). */
export async function lookupInvestmentForSimulationAction(investmentId: string): Promise<LookupInvestmentResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
    const investment = await findInvestmentForSimulation(actor.id, investmentId);
    return {
      ok: true,
      investment: {
        id: investment.id,
        ownerName: investment.ownerName,
        ownerEmail: investment.ownerEmail,
        packageName: investment.packageName,
        amount: toDisplay(investment.amount),
        status: investment.status,
      },
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}

export type SimulateDailyInterestRow = {
  daysProcessed: number;
  entriesPosted: number;
  totalCredited: string;
};

export type SimulateDailyInterestResult =
  | { ok: true; summary: SimulateDailyInterestRow }
  | { ok: false; errorKey: DeveloperToolsErrorKey };

/**
 * Calls requirePermission("DEVELOPER_TOOLS", ...) first — the real
 * server-side enforcement point (invariant #8) — before
 * simulateDailyInterestDays' own inline re-check, same defense-in-depth
 * pattern as every other action on this page. `days` is validated again
 * inside the lib function itself (never trust the client's own min/max on
 * the number input), and the investment id is re-resolved from scratch
 * there too — never trusts a client-supplied id without the lib layer's
 * own findUnique confirming it's real.
 */
export async function simulateDailyInterestAction(
  investmentId: string,
  days: number,
  locale: string,
): Promise<SimulateDailyInterestResult> {
  try {
    const actor = await requirePermission("DEVELOPER_TOOLS", new Date());
    const summary = await simulateDailyInterestDays(actor.id, investmentId, days, new Date());
    revalidatePath(`/${locale}/admin/developer-tools`);
    return {
      ok: true,
      summary: {
        daysProcessed: summary.daysProcessed,
        entriesPosted: summary.entriesPosted,
        totalCredited: toDisplay(summary.totalCredited),
      },
    };
  } catch (err) {
    return { ok: false, errorKey: mapError(err) };
  }
}
