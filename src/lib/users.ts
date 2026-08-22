import { z } from "zod";
import { prisma } from "./prisma";
import { hashPassword } from "./password";
import { securityQuestionInputSchema, type SecurityQuestionInput } from "./security-questions";
import { createWalletsForUser } from "./wallets";
import { placeInBinaryTree } from "./binary-tree";

const registrationInputSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1),
  securityQuestions: securityQuestionInputSchema,
});

export type RegistrationInput = z.infer<typeof registrationInputSchema>;

async function hashSecurityAnswers(questions: SecurityQuestionInput) {
  return Promise.all(
    questions.map(async (q) => ({
      question: q.question,
      answerHash: await hashPassword(q.answer.trim().toLowerCase()),
    })),
  );
}

/**
 * Self-registration under a sponsor's referral link. The link param is the
 * sponsor's raw user id (no separate referral-code scheme). Places the new
 * user in the sponsor tree only — placement-tree assignment is Phase 7.
 */
export async function registerWithSponsor(sponsorId: string, input: RegistrationInput) {
  const data = registrationInputSchema.parse(input);

  const sponsor = await prisma.user.findUnique({ where: { id: sponsorId } });
  if (!sponsor) {
    throw new Error("Invalid referral link: sponsor not found.");
  }
  if (sponsor.suspendedAt) {
    throw new Error("Invalid referral link: sponsor account is suspended.");
  }

  const passwordHash = await hashPassword(data.password);
  const hashedQuestions = await hashSecurityAnswers(data.securityQuestions);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
        role: "USER",
        sponsorId: sponsor.id,
      },
    });

    await tx.securityQuestion.createMany({
      data: hashedQuestions.map((q) => ({ userId: user.id, ...q })),
    });

    await createWalletsForUser(tx, user.id);
    await placeInBinaryTree(sponsor.id, user.id, tx);

    return user;
  });
}

/**
 * Self-registration with no referral code. Becomes a new tree root
 * (sponsorId left null) — intended for the first user in practice, but not
 * hard-blocked here for anyone else.
 */
export async function registerAsRoot(input: RegistrationInput) {
  const data = registrationInputSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  const hashedQuestions = await hashSecurityAnswers(data.securityQuestions);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
        role: "USER",
      },
    });

    await tx.securityQuestion.createMany({
      data: hashedQuestions.map((q) => ({ userId: user.id, ...q })),
    });

    await createWalletsForUser(tx, user.id);

    return user;
  });
}

const adminCreateUserInputSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1),
  sponsorId: z.string().optional(),
  reason: z.string().min(1, "A reason is required for admin-created accounts."),
});

export type AdminCreateUserInput = z.infer<typeof adminCreateUserInputSchema>;

/**
 * Admin-created account. Requires the acting admin to be the main admin or
 * hold USER_MANAGEMENT. Logged to admin_actions with the mandatory reason.
 */
export async function adminCreateUser(actingAdminId: string, input: AdminCreateUserInput) {
  const data = adminCreateUserInputSchema.parse(input);

  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }

  if (!admin.isMainAdmin) {
    const grant = await prisma.adminPermissionGrant.findUnique({
      where: {
        adminUserId_permission: {
          adminUserId: actingAdminId,
          permission: "USER_MANAGEMENT",
        },
      },
    });
    if (!grant) {
      throw new Error("Forbidden: missing USER_MANAGEMENT permission.");
    }
  }

  if (data.sponsorId) {
    const sponsor = await prisma.user.findUnique({ where: { id: data.sponsorId } });
    if (!sponsor) {
      throw new Error("Invalid sponsor: user not found.");
    }
    if (sponsor.suspendedAt) {
      throw new Error("Invalid sponsor: account is suspended.");
    }
  }

  const passwordHash = await hashPassword(data.password);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
        role: "USER",
        sponsorId: data.sponsorId,
        createdByAdminId: actingAdminId,
      },
    });

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "USER_CREATED",
        targetUserId: user.id,
        reason: data.reason,
      },
    });

    await createWalletsForUser(tx, user.id);

    if (data.sponsorId) {
      await placeInBinaryTree(data.sponsorId, user.id, tx);
    }

    return user;
  });
}

/**
 * A user's own direct referrals (sponsor tree, one level — invariant #5:
 * never joins against binary_nodes), newest first. Ownership is enforced by
 * construction — sponsorId is the only filter, no separate target-user
 * param exists to view someone else's referrals (invariant #9).
 *
 * `hasPurchased` is derived from `_count.investments` rather than a stored
 * flag — whether a referral has ever bought a package is a fact fully
 * derivable from the investments table, so there's nothing to keep in sync.
 */
export async function listReferralsForUser(sponsorId: string) {
  const referrals = await prisma.user.findMany({
    where: { sponsorId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      email: true,
      createdAt: true,
      suspendedAt: true,
      _count: { select: { investments: true } },
    },
  });

  return referrals.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    createdAt: r.createdAt,
    suspendedAt: r.suspendedAt,
    hasPurchased: r._count.investments > 0,
  }));
}

export class CannotSuspendMainAdminError extends Error {
  constructor() {
    super("The main admin account cannot be suspended.");
    this.name = "CannotSuspendMainAdminError";
  }
}

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

const suspendUserInputSchema = z.object({
  reason: z.string().min(1, "A reason is required for suspending a user."),
});

/**
 * Full financial freeze (build_plan.md: "suspension is a full financial
 * freeze, not just an access block") — the flag this sets
 * (`users.suspended_at`) is read directly by every money-moving engine
 * (transfers, withdrawals, daily interest, direct/binary commission) and by
 * `isLegActive` for every leg this user is part of, all the way up the
 * placement tree. There is nothing further to "push" here: `isLegActive` is
 * a live, uncached query (SCRUM-76), so the very next call anywhere already
 * sees the new state — no separate re-evaluation step exists to trigger.
 *
 * No-op (not an error) if the target is already suspended — an admin
 * re-clicking "suspend" on an already-frozen account is an ordinary
 * outcome, matching this codebase's existing skip-not-throw convention for
 * adjacent states (see payDirectCommission's suspended-party skips).
 *
 * Cannot suspend the main admin (invariant #8 — only the main admin manages
 * other admin accounts; there would also be no path to reverse it).
 *
 * `forDate` is an explicit param, never `new Date()` internally (invariant
 * #4).
 */
export async function suspendUser(
  actingAdminId: string,
  targetUserId: string,
  input: { reason: string },
  forDate: Date,
) {
  const data = suspendUserInputSchema.parse(input);
  await assertHasUserManagementPermission(actingAdminId);

  const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
  if (target.isMainAdmin) {
    throw new CannotSuspendMainAdminError();
  }
  if (target.suspendedAt !== null) {
    return target;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: targetUserId },
      data: { suspendedAt: forDate },
    });
    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "USER_SUSPENDED",
        targetUserId,
        reason: data.reason,
      },
    });
    return updated;
  });
}

const reinstateUserInputSchema = z.object({
  reason: z.string().min(1, "A reason is required for reinstating a user."),
});

/**
 * Reverses suspendUser. No-op (not an error) if the target is already
 * active — mirrors suspendUser's own idempotent-adjacent-state convention.
 * Same live-query reasoning applies: isLegActive re-reads suspendedAt on
 * every call, so reinstatement is immediately visible everywhere with no
 * separate re-evaluation step.
 */
export async function reinstateUser(actingAdminId: string, targetUserId: string, input: { reason: string }) {
  const data = reinstateUserInputSchema.parse(input);
  await assertHasUserManagementPermission(actingAdminId);

  const target = await prisma.user.findUniqueOrThrow({ where: { id: targetUserId } });
  if (target.suspendedAt === null) {
    return target;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id: targetUserId },
      data: { suspendedAt: null },
    });
    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "USER_REINSTATED",
        targetUserId,
        reason: data.reason,
      },
    });
    return updated;
  });
}
