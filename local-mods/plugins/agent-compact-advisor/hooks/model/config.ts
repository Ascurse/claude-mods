/**
 * The mod's `userConfig` values, checked and defaulted.
 */
import type { PluginOptions } from "claude-code";

import type { LeftoverRule } from "./leftovers.ts";

const MINUTE = 60_000;
const MAX_SCORE = 100;
const MAX_PERCENT = 100;
const DEFAULTS = {
  threshold: 70,
  minTokens: 100_000,
  fullTokens: 300_000,
  cacheTtlMin: 5,
} as const;
const ALERT_PERCENT = 60;
const SYSTEM_ONE_URL = "http://127.0.0.1:8010";
const KEV_MODEL = "kev-latest";
const PREFIXES = "Хвосты для агента:|Хвосты для владельца:";
const NONE_WORDS = "нет|none";
// The last answer may only go to this machine (TASK-209: no transcript leaves it).
const LOOPBACK = /^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/?$/u;

/** What the hooks read from the options. */
export interface Config {
  readonly threshold: number;
  readonly minTokens: number;
  readonly fullTokens: number;
  readonly cacheTtlMs: number;
  /** System One's base URL, absent when P1 is off or the host is not loopback. */
  readonly kevUrl?: string;
  readonly kevModel: string;
  readonly leftovers: LeftoverRule;
  readonly guardCompactions: boolean;
  readonly statusLine: boolean;
  /** Leftovers neither gate nor count: for a coordinator that always waits. */
  readonly ignoreLeftovers: boolean;
  /** The words of the status line and the explanation. */
  readonly language: Language;
  /** The context share (%) from which to alert; 0 turns the alert off. */
  readonly alertPercent: number;
}

/** The languages the words come in. */
export type Language = "ru" | "en";

const positive = (
  options: PluginOptions,
  key: keyof typeof DEFAULTS,
): number => {
  const value = options[key];
  return typeof value === "number" && value > 0 ? value : DEFAULTS[key];
};

const text = (
  options: PluginOptions,
  key: string,
  fallback: string,
): string => {
  const value = options[key];
  return typeof value === "string" ? value.trim() : fallback;
};

const listOf = (value: string): readonly string[] =>
  value
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part !== "");

const kevUrlOf = (url: string): Readonly<{ kevUrl?: string }> =>
  LOOPBACK.test(url) ? { kevUrl: url.replace(/\/$/u, "") } : {};

const alertOf = (value: unknown): number =>
  typeof value === "number" && value >= 0 && value <= MAX_PERCENT
    ? value
    : ALERT_PERCENT;

/**
 * The config from the options `register` receives.
 * @param options the plugin's `userConfig` values
 * @returns the config
 */
export const configOf = (options: PluginOptions): Config => {
  const minTokens = positive(options, "minTokens");
  const fullTokens = positive(options, "fullTokens");
  return {
    threshold: Math.min(positive(options, "threshold"), MAX_SCORE),
    minTokens,
    fullTokens: Math.max(fullTokens, minTokens + 1),
    cacheTtlMs: positive(options, "cacheTtlMin") * MINUTE,
    ...kevUrlOf(text(options, "systemOneUrl", SYSTEM_ONE_URL)),
    kevModel: text(options, "kevModel", KEV_MODEL) || KEV_MODEL,
    leftovers: {
      prefixes: listOf(text(options, "leftoverPrefixes", PREFIXES)),
      noneWords: listOf(text(options, "noneWords", NONE_WORDS).toLowerCase()),
    },
    guardCompactions: options["guardCompactions"] !== false,
    statusLine: options["statusLine"] !== false,
    ignoreLeftovers: options["ignoreLeftovers"] === true,
    language: options["language"] === "en" ? "en" : "ru",
    alertPercent: alertOf(options["alertPercent"]),
  };
};
