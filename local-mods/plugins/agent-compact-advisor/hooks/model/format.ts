/**
 * The score in plain words: the short status line and `/compact-advisor`'s
 * answer, in the configured language.
 */
import type { AdvisorFacts } from "../../types";
import type { Config } from "./config.ts";
import { type Gate, kOf, type Verdict } from "./score.ts";
import { formOf, type Phrase, say } from "./words.ts";

const DECIMALS = 2;
const PERCENT = 100;

/** What the status line is drawn from. */
export interface Drawn {
  readonly verdict: Verdict;
  readonly facts: AdvisorFacts;
  readonly isCacheWarm: boolean;
  readonly isBackgroundKnown: boolean;
  readonly config: Config;
}

const gateWords = (language: Config["language"], gate: Gate): string => {
  const count =
    gate.kind === "agents" || gate.kind === "calls" ? gate.count : 0;
  const form = formOf(language, count);
  const phrases: Readonly<Record<Gate["kind"], string>> = {
    unread: say(language, "unread"),
    small: say(language, "small", {
      k: kOf(gate.kind === "small" ? gate.tokens : 0),
    }),
    agents: say(language, `agents${form}`, { n: count }),
    calls: say(language, count === 1 ? "callsSingle" : `calls${form}`, {
      n: count,
    }),
    leftovers: say(language, "leftovers", {
      text: gate.kind === "leftovers" ? gate.text : "",
    }),
  };
  return phrases[gate.kind];
};

const sizeOf = (
  language: Config["language"],
  facts: AdvisorFacts,
): readonly string[] =>
  facts.tokens === undefined
    ? []
    : [
        say(language, "size", { k: kOf(facts.tokens) }) +
          (facts.percent === undefined
            ? ""
            : say(language, "share", { n: facts.percent })),
      ];

const leftoversOf = (
  language: Config["language"],
  drawn: Drawn,
): readonly string[] => {
  const { kind } = drawn.facts.leftovers;
  const phrase: Phrase = kind === "none" ? "leftoversNone" : "leftoversUnknown";
  return kind === "listed" || drawn.config.ignoreLeftovers
    ? []
    : [say(language, phrase)];
};

const goalOf = (
  language: Config["language"],
  facts: AdvisorFacts,
): readonly string[] => {
  const { p1 } = facts;
  return p1.kind === "na"
    ? []
    : [
        p1.kind === "pending"
          ? say(language, "goalPending")
          : say(language, "goal", { n: Math.round(p1.value * PERCENT) }),
      ];
};

/**
 * Whether the context share has reached the alert percent.
 * @param facts the last context reading
 * @param config the alert percent, 0 for off
 * @returns true at or above it, never when off or unread
 */
export const isAlertOf = (
  facts: AdvisorFacts,
  config: Pick<Config, "alertPercent">,
): boolean =>
  config.alertPercent > 0 &&
  facts.percent !== undefined &&
  facts.percent >= config.alertPercent;

const headOf = (drawn: Drawn): readonly string[] => {
  const { verdict, facts, config } = drawn;
  const { language } = config;
  const { gate } = verdict;
  const lead = say(
    language,
    verdict.score >= config.threshold ? "good" : "wait",
  );
  return gate === undefined
    ? [
        `${lead}: ${say(language, "score", { n: verdict.score })}`,
        ...sizeOf(language, facts),
        ...leftoversOf(language, drawn),
        ...goalOf(language, facts),
        say(language, drawn.isCacheWarm ? "cacheWarm" : "cacheCold"),
        ...(drawn.isBackgroundKnown
          ? []
          : [say(language, "backgroundUnknown")]),
      ]
    : [
        `${say(language, "early")}: ${gateWords(language, gate)}`,
        // The size is the reason itself for these two.
        ...(gate.kind === "unread" || gate.kind === "small"
          ? []
          : sizeOf(language, facts)),
      ];
};

/**
 * The score with every signal in words, the first line of the explanation.
 * @param drawn the verdict, the facts and the config
 * @returns `хороший момент для /compact: оценка 82 из 100 · контекст 312k (62%) · …`
 */
export const summaryOf = (drawn: Drawn): string => headOf(drawn).join(" · ");

const shortSizeOf = (facts: AdvisorFacts): readonly string[] =>
  facts.tokens === undefined
    ? []
    : [
        kOf(facts.tokens) +
          (facts.percent === undefined ? "" : ` ${String(facts.percent)}%`),
      ];

/**
 * The status line: the score, or why it is early, then the size.
 * @param drawn the verdict, the facts and the config
 * @returns `/compact 82 · 312k 62%`
 */
export const statusLineOf = (drawn: Drawn): string => {
  const { verdict, facts, config } = drawn;
  const { gate } = verdict;
  return gate === undefined
    ? [`/compact ${String(verdict.score)}`, ...shortSizeOf(facts)].join(" · ")
    : [
        `/compact ${say(config.language, "early")}`,
        gateWords(config.language, gate),
        // Для этих двух размер уже назван в причине
        ...(gate.kind === "unread" || gate.kind === "small"
          ? []
          : shortSizeOf(facts)),
      ].join(" · ");
};

const PART_PHRASES: Readonly<Record<Verdict["parts"][number]["name"], Phrase>> =
  {
    fill: "partFill",
    leftovers: "partLeftovers",
    P1: "partP1",
    cache: "partCache",
  };

const noteOf = (drawn: Drawn): readonly string[] => {
  const { verdict, facts, config } = drawn;
  const { language } = config;
  return verdict.gate === undefined
    ? [
        ...verdict.parts.map(
          ({ name, value, weight }) =>
            `- ${say(language, PART_PHRASES[name])}: ${value.toFixed(DECIMALS)} × ${String(weight)}`,
        ),
        ...(config.ignoreLeftovers ? [say(language, "leftoversIgnored")] : []),
        ...(facts.p1.kind === "na" ? [say(language, "goalNotCounted")] : []),
        ...verdict.caps.map((cap) =>
          say(
            language,
            cap === "background" ? "capBackground" : "capLeftovers",
          ),
        ),
      ]
    : [`${say(language, "gate")}: ${gateWords(language, verdict.gate)}`];
};

/**
 * `/compact-advisor`'s answer: the status line, every part with its weight,
 * the gate or the caps, the size alert, and whether compactions get the
 * template.
 * @param drawn the verdict, the facts and the config
 * @param isGuarded whether the compaction guard is on
 * @returns a few lines of text
 */
export const explanationOf = (drawn: Drawn, isGuarded: boolean): string => {
  const { language, alertPercent } = drawn.config;
  return [
    summaryOf(drawn),
    ...noteOf(drawn),
    ...(isAlertOf(drawn.facts, drawn.config)
      ? [
          say(language, "alertNote", {
            n: drawn.facts.percent ?? 0,
            limit: alertPercent,
          }),
        ]
      : []),
    say(language, isGuarded ? "guardOn" : "guardOff"),
    say(language, "disclaimer"),
  ].join("\n");
};
