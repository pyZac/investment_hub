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

type Config = z.infer<typeof envSchema>;

let cached: Readonly<Config> | undefined;

/**
 * Validates and memoizes process.env on first access rather than eagerly at
 * module-import time. This module can end up bundled as more than one
 * independent instance in Next.js dev mode when it's reachable from both a
 * Server Component graph and a "use server" Server Action graph in the same
 * route (webpack doesn't always dedupe across those two boundaries) — each
 * instance used to run its own top-level `envSchema.safeParse(process.env)`
 * synchronously at import time, so a transient/incomplete process.env
 * snapshot during dev-mode's per-request module re-instantiation crashed the
 * whole request instead of being a recoverable retry. Lazy + memoized means
 * each duplicated instance validates at most once, on first real use, when
 * process.env is guaranteed fully populated — not racing module load order.
 */
function loadConfig(): Readonly<Config> {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }

  cached = Object.freeze(parsed.data);
  return cached;
}

export const config: Readonly<Config> = new Proxy({} as Readonly<Config>, {
  get(_target, prop: string | symbol) {
    return loadConfig()[prop as keyof Config];
  },
  has(_target, prop: string | symbol) {
    return prop in loadConfig();
  },
  ownKeys() {
    return Reflect.ownKeys(loadConfig());
  },
  getOwnPropertyDescriptor(_target, prop: string | symbol) {
    return Object.getOwnPropertyDescriptor(loadConfig(), prop);
  },
});
