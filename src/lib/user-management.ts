import { z } from "zod";
import { prisma } from "./prisma";
import { getWalletOverview } from "./wallets";
import { getRankProgressForUser } from "./rank";

const PAGE_SIZE = 20;

async function assertHasUserManagementPermission(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }
  if (admin.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findUnique({
    where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "USER_MANAGEMENT" } },
  });
  if (!grant) {
    throw new Error("Forbidden: missing USER_MANAGEMENT permission.");
  }
}

/**
 * Read-only user search is useful to more than one admin surface — the
 * USER_MANAGEMENT screen's own list, SCRUM-106's credit-issuance user
 * picker, SCRUM-111's manual-adjustment user picker (find a user, then
 * browse their ledger entries to pick one to reverse), and SCRUM-114's
 * ledger explorer user filter — a sub-admin may hold CREDIT_ISSUANCE,
 * MANUAL_ADJUSTMENT, or LEDGER_VIEW without also holding USER_MANAGEMENT.
 * Any one of the four grants is sufficient to search (never to see the
 * fuller getUserDetail surface below, which stays USER_MANAGEMENT-only —
 * wallet balances/investment/referral counts are a wider exposure than
 * "look up a user by name to pick as a target").
 */
async function assertHasUserManagementOrCreditIssuancePermission(actingAdminId: string): Promise<void> {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }
  if (admin.isMainAdmin) {
    return;
  }
  const grant = await prisma.adminPermissionGrant.findFirst({
    where: {
      adminUserId: actingAdminId,
      permission: { in: ["USER_MANAGEMENT", "CREDIT_ISSUANCE", "MANUAL_ADJUSTMENT", "LEDGER_VIEW", "SECURITY_VIEW"] },
    },
  });
  if (!grant) {
    throw new Error(
      "Forbidden: missing USER_MANAGEMENT, CREDIT_ISSUANCE, MANUAL_ADJUSTMENT, LEDGER_VIEW, or SECURITY_VIEW permission.",
    );
  }
}

/**
 * Highest-rankOrder RankAward per user, for exactly the given user ids —
 * the same "permanent rank, never a live re-evaluation" definition as
 * getRankProgressForUser's currentRank, but batched for a list screen
 * instead of one query per row. Users with no rank_awards row are simply
 * absent from the returned map (caller treats a missing entry as
 * "Unranked", same as getRankProgressForUser's null case).
 */
async function batchCurrentRankNames(userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const [activeRanks, awards] = await Promise.all([
    prisma.rankConfig.findMany({ where: { effectiveTo: null } }),
    prisma.rankAward.findMany({ where: { userId: { in: userIds } } }),
  ]);

  const rankOrderByName = new Map(activeRanks.map((r) => [r.rankName, r.rankOrder]));

  const highestByUser = new Map<string, { name: string; order: number }>();
  for (const award of awards) {
    const order = rankOrderByName.get(award.rank);
    if (order === undefined) continue; // rank no longer active — not shown as "current"
    const existing = highestByUser.get(award.userId);
    if (!existing || order > existing.order) {
      highestByUser.set(award.userId, { name: award.rank, order });
    }
  }

  return new Map([...highestByUser].map(([userId, r]) => [userId, r.name]));
}

const searchUsersInputSchema = z.object({
  query: z.string().trim().optional(),
  page: z.number().int().min(1).default(1),
});

export type SearchUsersInput = z.input<typeof searchUsersInputSchema>;

/**
 * Admin-facing user browser — gated on USER_MANAGEMENT OR CREDIT_ISSUANCE
 * (main admin bypasses), since both the user-management screen and the
 * credit-issuance user picker need read-only search without requiring a
 * sub-admin to hold both grants. This is deliberately NOT scoped by
 * invariant #9's "caller owns the resource" rule — an admin browsing
 * arbitrary users by design is the whole point of this function, unlike
 * every user-facing self-service query elsewhere in the codebase.
 */
export async function searchUsers(actingAdminId: string, input: SearchUsersInput) {
  await assertHasUserManagementOrCreditIssuancePermission(actingAdminId);
  const data = searchUsersInputSchema.parse(input);

  const where = data.query
    ? {
        OR: [
          { name: { contains: data.query, mode: "insensitive" as const } },
          { email: { contains: data.query, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (data.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: { id: true, name: true, email: true, createdAt: true, suspendedAt: true },
    }),
  ]);

  const rankNames = await batchCurrentRankNames(users.map((u) => u.id));

  return {
    users: users.map((u) => ({ ...u, currentRank: rankNames.get(u.id) ?? null })),
    total,
    page: data.page,
    pageSize: PAGE_SIZE,
  };
}

/**
 * Everything the admin user-detail panel needs: profile, read-only wallet
 * balances, active-investment count, direct-referral count (sponsor tree,
 * one level — invariant #5), and current rank.
 */
export async function getUserDetail(actingAdminId: string, targetUserId: string) {
  await assertHasUserManagementPermission(actingAdminId);

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: targetUserId },
    select: { id: true, name: true, email: true, createdAt: true, suspendedAt: true, sponsorId: true },
  });

  const [wallets, activeInvestmentCount, referralCount, rankProgress] = await Promise.all([
    getWalletOverview(targetUserId),
    prisma.investment.count({ where: { userId: targetUserId, status: "ACTIVE" } }),
    prisma.user.count({ where: { sponsorId: targetUserId } }),
    getRankProgressForUser(targetUserId, new Date()),
  ]);

  return {
    ...user,
    wallets,
    activeInvestmentCount,
    referralCount,
    currentRank: rankProgress.currentRank?.name ?? null,
  };
}
