import { z } from "zod";

/**
 * Business rules that are admin-editable and versioned (interest rate,
 * commission %, rank thresholds) live in DB config tables from Phase 2+,
 * never as constants here (invariant #6). This module only covers values
 * that are genuinely environment/deployment config.
 */
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url(),
  TIMEZONE: z.literal("Asia/Dubai").default("Asia/Dubai"),
  MIN_WITHDRAWAL: z.coerce.number().positive().default(50),
  // Rate placeholders — superseded by versioned config tables in Phase 2+.
  DEFAULT_DAILY_INTEREST_RATE_BP: z.coerce.number().nonnegative().default(0),
  DEFAULT_DIRECT_COMMISSION_RATE_BP: z.coerce.number().nonnegative().default(0),
  // Main admin account created by `prisma db seed` — no defaults, must be set explicitly.
  SEED_ADMIN_EMAIL: z.email(),
  SEED_ADMIN_PASSWORD: z.string().min(8),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const config = Object.freeze(parsed.data);
