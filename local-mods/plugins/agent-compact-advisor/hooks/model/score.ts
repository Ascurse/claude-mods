/**
 * The compaction score 0–100: gates, a weighted sum, caps, and its words.
 */
import type { AdvisorFacts, Leftovers, P1 } from "../../types";
import type { Config } from "./config.ts";

/** Everything a score is computed from at one moment. */
export interface Signals {
  readonly facts: AdvisorFacts;
  readonly runningAgents: number;
  /** Live background calls, undefined when agent-shell-watch says nothing. */
  readonly liveCalls: number | undefined;
  readonly now: number;
}

/** One weighted part of the score, its value 0..1. */
interface Part {
  readonly name: "fill" | "leftovers" | "P1" | "cache";
  readonly weight: number;
  readonly value: number;
}

/** Why the score is 0: structured, so the status line can word it. */
export type Gate =
  | Readonly<{ kind: "unread" }>
  | Readonly<{ kind: "small"; tokens: number }>
  | Readonly<{ kind: "agents"; count: number }>
  | Readonly<{ kind: "calls"; count: number }>
  | Readonly<{ kind: "leftovers"; text: string }>;

/** What caps the score at 60: something the advisor cannot see. */
type Cap = "background" | "leftovers";

/** A score and why it stands where it does. */
export interface Verdict {
  readonly score: number;
  /** The gate that set the score to 0, if one did. */
  readonly gate?: Gate;
  readonly parts: readonly Part[];
  readonly caps: readonly Cap[];
}

const PERCENT = 100;
const KILO = 1000;
const UNKNOWN_CAP = 60;
// The fill part is complete at this share of the window at most.
const FULL_SHARE = 0.9;
const WEIGHTS = { fill: 40, leftovers: 30, p1: 20, cache: 10 } as const;

const gateOf = (signals: Signals, config: Config): Gate | undefined => {
  const { facts, runningAgents, liveCalls = 0 } = signals;
  const { tokens = 0 } = facts;
  const gates: readonly (Gate | false)[] = [
    facts.tokens === undefined && { kind: "unread" },
    tokens < config.minTokens && { kind: "small", tokens },
    runningAgents > 0 && { kind: "agents", count: runningAgents },
    liveCalls > 0 && { kind: "calls", count: liveCalls },
    !config.ignoreLeftovers &&
      facts.leftovers.kind === "listed" && {
        kind: "leftovers",
        text: facts.leftovers.text,
      },
  ];
  return gates.find((gate) => gate !== false);
};

/**
 * Whether the prompt cache still holds the conversation's prefix.
 * @param signals the facts and the time now
 * @param config the cache's time to live
 * @returns true within the TTL of the last main turn's end
 */
export const isCacheWarm = (signals: Signals, config: Config): boolean =>
  signals.facts.lastTurnAt !== undefined &&
  signals.now - signals.facts.lastTurnAt < config.cacheTtlMs;

// Pending counts as 0: a suggestion cannot be taken back once a low P1 lands.
const p1Part = (p1: P1): readonly Part[] =>
  p1.kind === "na"
    ? []
    : [
        {
          name: "P1",
          weight: WEIGHTS.p1,
          value: p1.kind === "value" ? p1.value : 0,
        },
      ];

const fullOf = (signals: Signals, config: Config): number => {
  const { window } = signals.facts;
  const bound =
    window === undefined ? config.fullTokens : Math.floor(window * FULL_SHARE);
  return Math.max(Math.min(config.fullTokens, bound), config.minTokens + 1);
};

// Ignored leftovers leave the sum and the rest rescales, like an absent P1.
const leftoversPart = (
  leftovers: Leftovers,
  config: Config,
): readonly Part[] =>
  config.ignoreLeftovers
    ? []
    : [
        {
          name: "leftovers",
          weight: WEIGHTS.leftovers,
          value: leftovers.kind === "none" ? 1 : 0,
        },
      ];

const partsOf = (
  signals: Signals,
  config: Config,
  tokens: number,
): readonly Part[] => {
  const fill =
    (tokens - config.minTokens) / (fullOf(signals, config) - config.minTokens);
  return [
    { name: "fill", weight: WEIGHTS.fill, value: Math.min(1, fill) },
    ...leftoversPart(signals.facts.leftovers, config),
    ...p1Part(signals.facts.p1),
    {
      name: "cache",
      weight: WEIGHTS.cache,
      value: isCacheWarm(signals, config) ? 1 : 0,
    },
  ];
};

const capsOf = (signals: Signals, config: Config): readonly Cap[] => [
  ...(signals.liveCalls === undefined ? (["background"] as const) : []),
  ...(!config.ignoreLeftovers && signals.facts.leftovers.kind === "unknown"
    ? (["leftovers"] as const)
    : []),
];

const weighed = (signals: Signals, config: Config): Verdict => {
  const parts = partsOf(signals, config, signals.facts.tokens ?? 0);
  const total = parts.reduce((sum, part) => sum + part.weight, 0);
  const sum = parts.reduce(
    (summed, part) => summed + part.weight * part.value,
    0,
  );
  const caps = capsOf(signals, config);
  const raw = Math.round((PERCENT * sum) / total);
  return {
    score: caps.length > 0 ? Math.min(raw, UNKNOWN_CAP) : raw,
    parts,
    caps,
  };
};

/**
 * Scores this moment for a compaction.
 * @param signals the facts, agents, background calls and time
 * @param config thresholds and weights' bounds
 * @returns 0 with the gate that holds, else the weighted sum, capped at 60
 *   while background or (unless ignored) leftovers are unknown
 */
export const scoreOf = (signals: Signals, config: Config): Verdict => {
  const gate = gateOf(signals, config);
  return gate === undefined
    ? weighed(signals, config)
    : { score: 0, gate, parts: [], caps: [] };
};

/**
 * Tokens as thousands.
 * @param tokens a token count
 * @returns `312k`
 */
export const kOf = (tokens: number): string =>
  `${String(Math.round(tokens / KILO))}k`;
