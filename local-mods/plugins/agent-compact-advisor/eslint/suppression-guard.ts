import type { Linter } from "eslint";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

import { suppressionConfig, typeDirectiveConfig } from "./suppressions.ts";

/**
 * Second lint pass, run with `--no-inline-config`: reads the suppression
 * comments without applying them, so none can disable this guard.
 */
const guardConfig: Linter.Config[] = defineConfig(
  globalIgnores([
    "node_modules/**",
    "engine-types/**",
    ".claude-plugin/types/**",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "@typescript-eslint": tseslint.plugin },
  },
  suppressionConfig,
  typeDirectiveConfig,
);

export default guardConfig;
