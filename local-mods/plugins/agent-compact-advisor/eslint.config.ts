import js from "@eslint/js";
import type { Linter } from "eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import functional from "eslint-plugin-functional";
import importX from "eslint-plugin-import-x";
import jsdoc from "eslint-plugin-jsdoc";
import regexp from "eslint-plugin-regexp";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";
import unusedImports from "eslint-plugin-unused-imports";
import tseslint from "typescript-eslint";

import {
  suppressionConfig,
  typeDirectiveConfig,
} from "./eslint/suppressions.ts";

const SOURCE = ["hooks/**/*.{ts,tsx}"];
const MODEL = ["hooks/model/**/*.ts"];
const TESTS = ["tests/**/*.{ts,tsx}"];
const TOOLS = ["*.config.ts", "eslint/**/*.ts"];

/** Size and complexity budgets; the suppression guard refuses disabling them. */
const BUDGET = {
  fileLines: 250,
  functionLines: 40,
  complexity: 12,
  cognitive: 12,
  params: 3,
  depth: 3,
} as const;

/** sonarjs types its presets loosely; insist on the flat one. */
const sonarRecommended = ((): Linter.Config => {
  const preset = sonarjs.configs?.["recommended"];
  if (preset === undefined || Array.isArray(preset) || "env" in preset) {
    throw new TypeError("eslint-plugin-sonarjs: no flat recommended preset");
  }
  return preset as Linter.Config;
})();

const eslintConfig: Linter.Config[] = defineConfig(
  globalIgnores([
    "node_modules/**",
    "coverage/**",
    "engine-types/**",
    ".claude-plugin/types/**",
  ]),
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  unicorn.configs.recommended,
  sonarRecommended,
  regexp.configs["flat/recommended"],
  {
    languageOptions: {
      parserOptions: {
        // Explicit projects, not the project service: Claude Code lays its own
        // tsconfig.json into a mod folder it loads with --plugin-dir, which the
        // service would pick up as the nearest one.
        project: ["./tsconfig.json", "./tsconfig.tools.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "import-x": importX,
      "simple-import-sort": simpleImportSort,
      "unused-imports": unusedImports,
    },
    rules: {
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-cycle": "error",
      "import-x/no-self-import": "error",
      "import-x/first": "error",
      "import-x/newline-after-import": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/consistent-type-exports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/strict-boolean-expressions": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/no-magic-numbers": [
        "error",
        {
          ignore: [-1, 0, 1],
          enforceConst: true,
          ignoreArrayIndexes: true,
          ignoreTypeIndexes: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
        },
      ],
      eqeqeq: "error",
      curly: ["error", "all"],
      "no-console": "error",
      "no-nested-ternary": "error",
      "prefer-template": "error",
      "object-shorthand": "error",
      "max-lines": [
        "error",
        { max: BUDGET.fileLines, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: BUDGET.functionLines, skipBlankLines: true, skipComments: true },
      ],
      "max-params": ["error", BUDGET.params],
      "max-depth": ["error", BUDGET.depth],
      complexity: ["error", BUDGET.complexity],
      "sonarjs/cognitive-complexity": ["error", BUDGET.cognitive],
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
      // The hooks API names its arguments `$`, `e` and `next`.
      "unicorn/name-replacements": [
        "error",
        { allowList: { e: true, props: true, args: true } },
      ],
      // A hooks module runs without Node; `null` is the engine's own "none".
      "unicorn/prefer-node-protocol": "off",
      "unicorn/no-null": "off",
      // Both conflict with JSDoc's own `*`-prefixed block style, which
      // jsdoc/require-asterisk-prefix and Prettier keep.
      "unicorn/no-asterisk-prefix-in-documentation-comments": "off",
      "unicorn/single-line-block-comment-style": "off",
    },
  },
  {
    files: SOURCE,
    plugins: { functional, jsdoc },
    extends: [
      functional.configs.lite,
      functional.configs.stylistic,
      jsdoc.configs["flat/recommended-typescript-error"],
    ],
    rules: {
      // Hook callbacks are typed by the engine (`$`, `e`, `next`); their
      // parameter types are the engine's, so only our own types must be
      // readonly.
      "functional/prefer-immutable-types": [
        "error",
        { enforcement: "ReadonlyShallow", ignoreInferredTypes: true },
      ],
      "functional/functional-parameters": [
        "error",
        { enforceParameterCount: false },
      ],
      // `register` and engine callbacks are void by the API's contract.
      "functional/no-return-void": "off",
      "functional/no-let": "error",
      "functional/immutable-data": "error",
      "functional/no-loop-statements": "error",
      "functional/no-classes": "error",
      "functional/no-this-expressions": "error",
      "jsdoc/require-jsdoc": [
        "error",
        { publicOnly: true, require: { ArrowFunctionExpression: true } },
      ],
    },
  },
  {
    // The model is pure: no effects, no void, nothing thrown.
    files: MODEL,
    extends: [functional.configs.strict],
    rules: {
      "functional/prefer-immutable-types": [
        "error",
        { enforcement: "ReadonlyDeep", ignoreInferredTypes: true },
      ],
      "functional/functional-parameters": [
        "error",
        { enforceParameterCount: false },
      ],
    },
  },
  {
    files: TESTS,
    rules: {
      "max-lines-per-function": "off",
      "@typescript-eslint/no-magic-numbers": "off",
      "sonarjs/no-duplicate-string": "off",
    },
  },
  {
    files: TOOLS,
    extends: [tseslint.configs.disableTypeChecked],
    rules: { "@typescript-eslint/no-magic-numbers": "off" },
  },
  suppressionConfig,
  typeDirectiveConfig,
);

export default eslintConfig;
