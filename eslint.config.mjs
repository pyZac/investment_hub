import { defineConfig, globalIgnores } from "eslint/config";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    // Invariant #1: no JS `number` for money, ever — use Prisma.Decimal end
    // to end. This rule can't know which values are money, so it flags the
    // common ways precision loss creeps in and relies on code review for the
    // rest. See CLAUDE.md, invariant #1.
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message:
            "parseFloat() loses precision — use Prisma.Decimal for any monetary value (invariant #1).",
        },
        {
          selector:
            "CallExpression[callee.name='Number'][arguments.0.type!='Literal']",
          message:
            "Number(x) on a non-literal is often a monetary value being coerced — use Prisma.Decimal instead (invariant #1).",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),
]);

export default eslintConfig;
