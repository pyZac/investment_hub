import { z } from "zod";
import { prisma } from "./prisma";
import { hashPassword, verifyPassword } from "./password";
import { assertNotLockedOut, recordFailedAttempt, maybeTriggerLockout } from "./rate-limit";

const QUESTION_COUNT = 3;

// Free-text fields are length-capped and stripped of control characters at
// the validation layer, per the build plan's security section.
const questionTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\x00-\x1F\x7F]*$/, "Control characters are not allowed.");

const answerSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\x00-\x1F\x7F]*$/, "Control characters are not allowed.");

export const securityQuestionInputSchema = z
  .array(z.object({ question: questionTextSchema, answer: answerSchema }))
  .length(QUESTION_COUNT);

export type SecurityQuestionInput = z.infer<typeof securityQuestionInputSchema>;

function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

/**
 * Sets a user's security questions, replacing any existing ones. Used both at
 * self-registration and on an admin-created account's first login (per the
 * phase brief: those accounts set theirs on first login, not at creation).
 */
export async function setSecurityQuestions(userId: string, input: SecurityQuestionInput) {
  const data = securityQuestionInputSchema.parse(input);

  const answerHashes = await Promise.all(
    data.map((q) => hashPassword(normalizeAnswer(q.answer))),
  );

  return prisma.$transaction(async (tx) => {
    await tx.securityQuestion.deleteMany({ where: { userId } });
    await tx.securityQuestion.createMany({
      data: data.map((q, i) => ({
        userId,
        question: q.question,
        answerHash: answerHashes[i],
      })),
    });
    return tx.securityQuestion.findMany({ where: { userId } });
  });
}

const resetInputSchema = z.object({
  email: z.email(),
  answers: z.array(answerSchema).length(QUESTION_COUNT),
  newPassword: z.string().min(8),
});

export type ResetPasswordViaSecurityQuestionsInput = z.infer<typeof resetInputSchema>;

const SECURITY_QUESTION_EVENT_TYPES = ["SECURITY_QUESTION_FAILED"] as const;

/**
 * Self-service password reset. All stored security questions must be
 * answered correctly, in the order they were originally created, before the
 * password is changed. No email/SMS exists in this system, so this is the
 * only self-service reset path. Rate-limited and lockout-protected (5
 * failures / 15 min, per-account and per-IP).
 */
export async function resetPasswordViaSecurityQuestions(
  input: ResetPasswordViaSecurityQuestionsInput,
  forDate: Date,
  ipAddress: string,
) {
  const data = resetInputSchema.parse(input);

  await assertNotLockedOut([...SECURITY_QUESTION_EVENT_TYPES], data.email, ipAddress, forDate);

  const fail = async (userId?: string) => {
    await recordFailedAttempt("SECURITY_QUESTION_FAILED", data.email, ipAddress, forDate, userId);
    await maybeTriggerLockout([...SECURITY_QUESTION_EVENT_TYPES], data.email, forDate, userId);
    throw new Error("Invalid email or answers.");
  };

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) {
    return fail();
  }

  const questions = await prisma.securityQuestion.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  if (questions.length !== QUESTION_COUNT) {
    return fail(user.id);
  }

  const results = await Promise.all(
    questions.map((q, i) => verifyPassword(q.answerHash, normalizeAnswer(data.answers[i]))),
  );

  if (!results.every(Boolean)) {
    return fail(user.id);
  }

  const passwordHash = await hashPassword(data.newPassword);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
}

const adminResetInputSchema = z.object({
  newPassword: z.string().min(8),
  reason: z.string().min(1, "A reason is required for admin password resets."),
});

export type AdminResetPasswordInput = z.infer<typeof adminResetInputSchema>;

/**
 * Admin manual password reset. Requires the acting admin to be the main
 * admin or hold USER_MANAGEMENT. Logged to admin_actions with the mandatory
 * reason. There is no token-based reset flow in this system.
 */
export async function adminResetPassword(
  actingAdminId: string,
  targetUserId: string,
  input: AdminResetPasswordInput,
) {
  const data = adminResetInputSchema.parse(input);

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

  const target = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!target) {
    throw new Error("Target user not found.");
  }

  const passwordHash = await hashPassword(data.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: targetUserId }, data: { passwordHash } });
    await tx.adminAction.create({
      data: {
        adminId: actingAdminId,
        actionType: "PASSWORD_RESET",
        targetUserId,
        reason: data.reason,
      },
    });
  });
}
