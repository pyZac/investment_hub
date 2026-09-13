import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

async function requireCommissionConfigPermission(actingAdminId: string) {
  const admin = await prisma.user.findUnique({ where: { id: actingAdminId } });
  if (!admin || admin.role !== "ADMIN") {
    throw new Error("Forbidden: acting user is not an admin.");
  }

  if (!admin.isMainAdmin) {
    const grant = await prisma.adminPermissionGrant.findUnique({
      where: { adminUserId_permission: { adminUserId: actingAdminId, permission: "COMMISSION_CONFIG" } },
    });
    if (!grant) {
      throw new Error("Forbidden: missing COMMISSION_CONFIG permission.");
    }
  }

  return admin;
}

export class BackdatedCommissionConfigError extends Error {
  constructor() {
    super("The effective date must be in the future — commission rule changes cannot be backdated.");
    this.name = "BackdatedCommissionConfigError";
  }
}

export class SplitMismatchError extends Error {
  constructor() {
    super("directCommissionSplit and directSavingSplit must sum to exactly 100%.");
    this.name = "SplitMismatchError";
  }
}

const setCommissionConfigInputSchema = z.object({
  directRate: z.string().or(z.number()),
  directCommissionSplit: z.string().or(z.number()),
  directSavingSplit: z.string().or(z.number()),
  binaryRate: z.string().or(z.number()),
  binaryCarryForwardExpiryMonths: z.number().int().positive(),
  effectiveFrom: z.date(),
  reason: z.string().min(1, "A reason is required to change commission rules."),
});

export type SetCommissionConfigInput = z.infer<typeof setCommissionConfigInputSchema>;

/**
 * Admin-facing versioned commission-rule change (SCRUM-109). Mirrors
 * rate-config.ts's setInterestRate exactly — no admin-facing write path
 * existed for commission_config before this ticket (Phase 5/6 only ever
 * wrote this table via raw prisma calls inside test files, never through a
 * real permission-gated function). Never edits an existing row — closes the
 * current open-ended row (its effectiveTo becomes the new row's
 * effectiveFrom) and inserts a brand-new row, both in one transaction, in
 * that order (per the documented partial-unique-index lesson on this table:
 * commission_config_one_active is a unique index on a constant expression
 * WHERE effective_to IS NULL — inserting a second open-ended row before
 * closing the first would violate it).
 *
 * `directCommissionSplit`/`directSavingSplit` are percentages OF
 * `directRate`, not independent percentages of the investment amount — they
 * must sum to exactly 100 (SplitMismatchError otherwise, nothing written).
 * `binaryCarryForwardExpiryMonths` stays in months, matching the real
 * schema/mlm_rules_log.md convention ("default 6 months") — not weeks.
 *
 * `effectiveFrom` must be strictly in the future relative to `forDate`
 * (caller-supplied, invariant #4) — no backdating, matching the phase-11
 * doc's "forward-effective only" rule; "now" itself counts as backdated.
 */
export async function setCommissionConfig(actingAdminId: string, input: SetCommissionConfigInput, forDate: Date) {
  const data = setCommissionConfigInputSchema.parse(input);
  await requireCommissionConfigPermission(actingAdminId);

  if (data.effectiveFrom.getTime() <= forDate.getTime()) {
    throw new BackdatedCommissionConfigError();
  }

  const splitSum = new Prisma.Decimal(data.directCommissionSplit).add(data.directSavingSplit);
  if (!splitSum.eq(100)) {
    throw new SplitMismatchError();
  }

  return prisma.$transaction(async (tx) => {
    await tx.commissionConfig.updateMany({
      where: { effectiveTo: null },
      data: { effectiveTo: data.effectiveFrom },
    });

    const created = await tx.commissionConfig.create({
      data: {
        directRate: data.directRate,
        directCommissionSplit: data.directCommissionSplit,
        directSavingSplit: data.directSavingSplit,
        binaryRate: data.binaryRate,
        binaryCarryForwardExpiryMonths: data.binaryCarryForwardExpiryMonths,
        effectiveFrom: data.effectiveFrom,
        effectiveTo: null,
        setByAdminId: actingAdminId,
      },
    });

    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "COMMISSION_CONFIG_SET",
        reason: data.reason,
      },
    });

    return created;
  });
}

/**
 * The commission_config row genuinely active AT `forDate` — NOT simply "the
 * row with effectiveTo: null". Those differ the instant a future-dated
 * change has been scheduled: the still-open-ended row briefly stops being
 * "current" the moment a new row is created for it (setCommissionConfig
 * closes the OLD row's effectiveTo to the NEW row's effectiveFrom), but the
 * new row's own effectiveFrom can still be in the future. Mirrors
 * binary-cycle.ts's activeCommissionConfigAt lookup exactly (same bounds),
 * matching the SCRUM-108 lesson (rate-config.ts's getCurrentRate) rather
 * than direct-commission.ts's own "effectiveTo: null" shortcut — this admin
 * panel display must never disagree with what the accrual engines actually
 * use for a given date. Takes `forDate` explicitly (invariant #4).
 */
export async function getCurrentCommissionConfig(actingAdminId: string, forDate: Date) {
  await requireCommissionConfigPermission(actingAdminId);

  return prisma.commissionConfig.findFirst({
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
 * history view. COMMISSION_CONFIG-gated (main admin bypass); this is an
 * admin-facing config table, not user-owned data, so invariant #9's
 * self-ownership rule doesn't apply here.
 */
export async function listCommissionConfigHistory(actingAdminId: string) {
  await requireCommissionConfigPermission(actingAdminId);

  return prisma.commissionConfig.findMany({
    orderBy: { effectiveFrom: "desc" },
    include: { setByAdmin: { select: { name: true } } },
  });
}
