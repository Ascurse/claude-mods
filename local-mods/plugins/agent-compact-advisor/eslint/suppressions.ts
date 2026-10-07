import eslintComments from "@eslint-community/eslint-plugin-eslint-comments";
import type { ESLint, Linter } from "eslint";

const plugin = eslintComments as unknown as ESLint.Plugin;

/**
 * Rules whose suppression the repository never accepts. Every other
 * `eslint-disable-next-line` needs a `-- reason`. The guard pass
 * (`eslint/suppression-guard.ts`) runs with inline config off, so a comment
 * cannot switch these off either.
 */
const NEVER_SUPPRESSED = [
  "@eslint-community/eslint-comments/*",
  "@typescript-eslint/ban-ts-comment",
  "@typescript-eslint/no-explicit-any",
  "@typescript-eslint/no-unsafe-*",
  "@typescript-eslint/no-floating-promises",
  "@typescript-eslint/no-misused-promises",
  "@typescript-eslint/no-non-null-assertion",
  "functional/immutable-data",
  "functional/no-let",
  "max-lines",
  "max-lines-per-function",
  "complexity",
  "sonarjs/cognitive-complexity",
] as const;

export const suppressionConfig: Linter.Config = {
  plugins: { "@eslint-community/eslint-comments": plugin },
  rules: {
    "@eslint-community/eslint-comments/no-use": [
      "error",
      { allow: ["eslint-disable-next-line"] },
    ],
    "@eslint-community/eslint-comments/require-description": "error",
    "@eslint-community/eslint-comments/no-restricted-disable": [
      "error",
      ...NEVER_SUPPRESSED,
    ],
    "@eslint-community/eslint-comments/no-unused-disable": "error",
  },
};

export const typeDirectiveConfig: Linter.Config = {
  rules: {
    "@typescript-eslint/ban-ts-comment": [
      "error",
      {
        "ts-check": false,
        "ts-expect-error": true,
        "ts-ignore": true,
        "ts-nocheck": true,
      },
    ],
  },
};
