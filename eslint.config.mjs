import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated / vendored — not ours to lint.
    "node_modules/**",
    ".claude/worktrees/**",
    "prisma/migrations/**",
  ]),
  // Moderate strictness on top of the Next defaults. These are all
  // syntactic rules (no type-checking required), so lint stays fast and
  // doesn't need parserOptions.project. no-explicit-any is a warning so it
  // flags new `any` usage without breaking the build.
  {
    files: ["**/*.{ts,tsx,mts,js,mjs}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "prefer-const": "error",
      "no-var": "error",
      eqeqeq: ["error", "smart"],
      "no-console": "off",
    },
  },
]);

export default eslintConfig;
