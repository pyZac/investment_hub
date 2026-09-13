import { z } from "zod";
import { prisma } from "./prisma";

async function requireRateConfigPermission(actingAdminId: string) {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }

  if (!admin.isMainAdmin) {
    const grant = await prisma.adminPermissionGrant.findUnique({
      where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "RATE_CONFIG" } },
    });
    if (!grant) {
      throw new Error("Forbidden: missing RATE_CONFIG permission.");
    }
  }

  return admin;
}

export class BackdatedRateError extends Error {
  constructor() {
    super("The effective date must be in the future — rate changes cannot be backdated.");
    this.name = "BackdatedRateError";
  }
}

const setInterestRateInputSchema = z.object({
  monthlyRate: z.string().or(z.number()),
  effectiveFrom: z.date(),
  reason: z.string().min(1, "A reason is required to change the interest rate."),
});

export type SetInterestRateInput = z.infer<typeof setInterestRateInputSchema>;

/**
 * Admin-facing versioned rate change (SCRUM-108). Never edits an existing
 * row — closes the current open-ended row (sets its effectiveTo to the new
 * row's effectiveFrom) and inserts a brand-new row, both in one
 * transaction. Order matters: close the old row BEFORE inserting the new
 * one, per the documented partial-unique-index lesson on this table
 * (interest_rate_config_one_active is a unique index on a constant
 * expression WHERE effective_to IS NULL — inserting a second open-ended
 * row before closing the first would violate it).
 *
 * `effectiveFrom` must be strictly in the future relative to `forDate`
 * (caller-supplied, per invariant #4 — never `new Date()` internally for
 * the comparison) — no backdating, matching the phase-11 doc's
 * "forward-effective... no grandfathering" rule. "Now" itself is treated
 * as backdated (must be >, not >=) since a rate that's already "effective"
 * at the moment of submission has no real forward-looking meaning to
 * distinguish it from an immediate edit.
 */
export async function setInterestRate(actingAdminId: string, input: SetInterestRateInput, forDate: Date) {
  const data = setInterestRateInputSchema.parse(input);
  await requireRateConfigPermission(actingAdminId);

  if (data.effectiveFrom.getTime() <= forDate.getTime()) {
    throw new BackdatedRateError();
  }

  return prisma.$transaction(async (tx) => {
    await tx.interestRateConfig.updateMany({
      where: { effectiveTo: null },
      data: { effectiveTo: data.effectiveFrom },
    });

    const created = await tx.interestRateConfig.create({
      data: {
        monthlyRate: data.monthlyRate,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: null,
        setByAdminId: actingAdminId,
      },
    });

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "RATE_CONFIG_SET",
        amount: data.monthlyRate,
        reason: data.reason,
      },
    });

    return created;
  });
}

/**
 * The rate genuinely active AT `forDate` — NOT simply "the row with
 * effectiveTo: null". Those are different things once a future-dated rate
 * change has been scheduled: the still-open-ended row briefly stops being
 * "current" the moment a new row is created for it (setInterestRate closes
 * the OLD row's effectiveTo to the NEW row's effectiveFrom), but the new
 * row's own effectiveFrom is still in the future, so `effectiveTo: null`
 * alone would incorrectly point at the not-yet-active new row instead of
 * the row genuinely in effect right now. Mirrors dailyRate()'s exact
 * lookup logic (interest-rate.ts) — same bounds, same "no active row"
 * possibility — so the admin panel's "current rate" display can never
 * disagree with what the accrual engine is actually using. Takes `forDate`
 * explicitly (invariant #4), never `new Date()` internally, even though
 * this is read-only. RATE_CONFIG-gated, same as listRateHistory — this is
 * the admin panel's own display, distinct from the permission-free
 * dailyRate() the accrual engine calls internally.
 */
export async function getCurrentRate(actingAdminId: string, forDate: Date) {
  await requireRateConfigPermission(actingAdminId);

  return prisma.interestRateConfig.findFirst({
    where: {
      effectiveFrom: { lte: forDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: forDate } }],
    },
    orderBy: { effectiveFrom: "desc" },
    include: { setByAdmin: { select: { name: true } } },
  });
}

/**
 * Full version history, newest effectiveFrom first — the admin panel's
 * history view. RATE_CONFIG-gated (main admin bypass); this is an
 * admin-facing config table, not user-owned data, so invariant #9's
 * self-ownership rule doesn't apply here.
 */
export async function listRateHistory(actingAdminId: string) {
  await requireRateConfigPermission(actingAdminId);

  return prisma.interestRateConfig.findMany({
    orderBy: { effectiveFrom: "desc" },
    include: { setByAdmin: { select: { name: true } } },
  });
}
