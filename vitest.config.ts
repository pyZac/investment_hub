import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // argon2 hashing is CPU-heavy; tests that hash multiple passwords/answers
    // per case can exceed the 5s default when many test files run in parallel.
    testTimeout: 20000,
    // All tests run against the real shared dev Postgres instance (no isolated
    // test DB — see lessons.md). reconciliation.test.ts asserts on the entire
    // wallets/ledger_entries tables (by design, checking global solvency), so
    // running test files in parallel let it intermittently observe another
    // file's in-flight transaction. Sequential execution trades suite speed
    // for eliminating that whole class of cross-file race.
    fileParallelism: false,
    // Forces the mandatory-admin-TOTP invariant to stay enforced in tests
    // regardless of a developer's local .env DISABLE_ADMIN_TOTP convenience
    // toggle (added 2026-09-12 to unblock manual admin-panel review) — the
    // suite must always exercise the real production-equivalent auth
    // behavior, never a host machine's local override. Overrides .env,
    // which loads first.
    env: {
      DISABLE_ADMIN_TOTP: "false",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
