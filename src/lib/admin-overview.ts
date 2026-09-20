import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getSolvencyOverview, type SolvencyOverview } from "./solvency";
import { listJobStatuses, type JobStatus } from "./job-monitor";
import { dubaiMonthKey } from "./rank";

export class NotMainAdminError extends Error {
  constructor() {
    super("Forbidden: only the main admin can view the overview dashboard.");
    this.name = "NotMainAdminError";
  }
}

async function assertActingUserIsMainAdmin(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN" || !admin.isMainAdmin) {
    throw new NotMainAdminError();
  }
}

const UPCOMING_RELEASE_WINDOW_DAYS = 30;

export type PackageBreakdownRow = {
  packageId: string;
  packageName: string;
  investmentCount: number;
  totalValue: Prisma.Decimal;
};

export type UpcomingReleaseRow = {
  investmentId: string;
  userName: string;
  packageName: string;
  amount: Prisma.Decimal;
  capitalUnlocksAt: Date;
};

export type AdminOverview = {
  investments: {
    activeCount: number;
    activeTotalValue: Prisma.Decimal;
    totalLockedCapital: Prisma.Decimal;
    byPackage: PackageBreakdownRow[];
    upcomingReleases: UpcomingReleaseRow[];
  };
  financialHealth: SolvencyOverview;
  userActivity: {
    totalUsers: number;
    totalMarketers: number;
    totalSuspended: number;
    newThisMonth: number;
  };
  jobs: JobStatus[];
};

/**
 * The main-admin dashboard overview (post-phase feature): a single
 * read-only aggregation of data that already exists elsewhere in the
 * system, built for a glance view rather than a detailed report. No new
 * financial/business logic is introduced here — this file only counts,
 * sums, and groups rows that other engine functions already write, plus
 * two direct reuses (getSolvencyOverview, listJobStatuses) rather than
 * reimplementing either.
 *
 * Main-admin-only (not permission-gated like most admin screens) per this
 * feature's own requirement — mirrors admin-management.ts's
 * assertActingUserIsMainAdmin pattern exactly, since sub-admin account
 * management is the closest existing main-admin-only precedent in this
 * codebase.
 *
 * `totalLockedCapital` is the same figure as `activeTotalValue`: an ACTIVE
 * investment's `amount` field IS the locked capital currently sitting in
 * the user's Wallet A (purchasePackage credits the full principal into A
 * at purchase time; capital release is later the same money moving A -> B,
 * per solvency.ts's own documented reasoning for why "locked capital" is
 * not a separate pool to sum on top of wallet/investment values). Kept as
 * a separate named field anyway because the ticket calls it out as its own
 * stat card, not to imply a different source of truth.
 *
 * `newThisMonth` compares each user's own `createdAt`'s dubaiMonthKey
 * against `forDate`'s dubaiMonthKey (rank.ts's existing helper, reused
 * rather than re-deriving month-boundary arithmetic — see the standing
 * lesson about not hand-rolling business-day/month bucketing a second
 * time). `forDate` is an explicit parameter throughout (invariant #4).
 */
export async function getAdminOverview(actingAdminId: string, forDate: Date): Promise<AdminOverview> {
  await assertActingUserIsMainAdmin(actingAdminId);

  const windowEnd = new Date(forDate.getTime() + UPCOMING_RELEASE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [activeInvestments, upcomingReleaseRows, solvency, jobs, totalUsers, totalMarketers, totalSuspended, allUsers] =
    await Promise.all([
      prisma.investment.findMany({
        where: { status: "ACTIVE" },
        select: { id: true, amount: true, packageId: true, package: { select: { name: true } } },
      }),
      prisma.investment.findMany({
        where: { status: "ACTIVE", capitalUnlocksAt: { gte: forDate, lte: windowEnd } },
        select: {
          id: true,
          amount: true,
          capitalUnlocksAt: true,
          package: { select: { name: true } },
          user: { select: { name: true } },
        },
        orderBy: { capitalUnlocksAt: "asc" },
      }),
      getSolvencyOverview(actingAdminId, forDate),
      listJobStatuses(actingAdminId),
      prisma.user.count({ where: { role: "USER" } }),
      prisma.user.count({ where: { role: "USER", isMarketer: true } }),
      prisma.user.count({ where: { role: "USER", suspendedAt: { not: null } } }),
      prisma.user.findMany({ where: { role: "USER" }, select: { createdAt: true } }),
    ]);

  const zero = new Prisma.Decimal(0);
  const activeTotalValue = activeInvestments.reduce((sum, inv) => sum.add(inv.amount), zero);

  const byPackageMap = new Map<string, PackageBreakdownRow>();
  for (const inv of activeInvestments) {
    const existing = byPackageMap.get(inv.packageId);
    if (existing) {
      existing.investmentCount += 1;
      existing.totalValue = existing.totalValue.add(inv.amount);
    } else {
      byPackageMap.set(inv.packageId, {
        packageId: inv.packageId,
        packageName: inv.package.name,
        investmentCount: 1,
        totalValue: new Prisma.Decimal(inv.amount),
      });
    }
  }
  const byPackage = [...byPackageMap.values()].sort((a, b) => b.totalValue.cmp(a.totalValue));

  const upcomingReleases: UpcomingReleaseRow[] = upcomingReleaseRows.map((inv) => ({
    investmentId: inv.id,
    userName: inv.user.name,
    packageName: inv.package.name,
    amount: inv.amount,
    capitalUnlocksAt: inv.capitalUnlocksAt,
  }));

  const currentMonthKey = dubaiMonthKey(forDate);
  const newThisMonth = allUsers.filter((u) => dubaiMonthKey(u.createdAt) === currentMonthKey).length;

  return {
    investments: {
      activeCount: activeInvestments.length,
      activeTotalValue,
      totalLockedCapital: activeTotalValue,
      byPackage,
      upcomingReleases,
    },
    financialHealth: solvency,
    userActivity: {
      totalUsers,
      totalMarketers,
      totalSuspended,
      newThisMonth,
    },
    jobs,
  };
}
