/**
 * The advisor's words in each language: plain text with `{name}` holes.
 */
import type { Language } from "./config.ts";

const RU = {
  early: "рано",
  wait: "можно подождать",
  good: "хороший момент для /compact",
  score: "оценка {n} из 100",
  unread: "размер контекста ещё неизвестен",
  small: "контекст мал ({k})",
  agentsOne: "работает {n} агент",
  agentsFew: "работает {n} агента",
  agentsMany: "работают {n} агентов",
  callsSingle: "идёт фоновая задача",
  callsOne: "идёт {n} фоновая задача",
  callsFew: "идут {n} фоновые задачи",
  callsMany: "идут {n} фоновых задач",
  leftovers: "хвосты — {text}",
  size: "контекст {k}",
  share: " ({n}%)",
  leftoversNone: "хвостов нет",
  leftoversUnknown: "хвосты неизвестны",
  goal: "цель достигнута с вероятностью {n}%",
  goalPending: "проверяю, достигнута ли цель",
  cacheWarm: "кэш тёплый",
  cacheCold: "кэш остыл",
  backgroundUnknown: "фоновые задачи неизвестны",
  alert: "контекст {n}% — пора компактить",
  partFill: "заполнение",
  partLeftovers: "хвосты",
  partP1: "цель достигнута",
  partCache: "кэш",
  goalNotCounted:
    "- цель достигнута: не учитывается (вес снят, остальное пересчитано)",
  leftoversIgnored:
    "- хвосты: не учитываются по настройке (вес снят, остальное пересчитано)",
  capBackground:
    "- потолок 60: фоновые задачи неизвестны (нет agent-shell-watch)",
  capLeftovers: "- потолок 60: в последнем ответе нет строк о хвостах",
  gate: "- рано",
  alertNote:
    "- тревога: контекст {n}% не ниже порога {limit}%; в конце хода предлагается /compact",
  guardOn: "Каждый /compact и автокомпакт получает шаблон сохранения.",
  guardOff: "Защита выключена: /compact выполняется как набран.",
  disclaimer: "Это оценка, а не вероятность: ничего здесь не калибровано.",
} as const;

const EN: Readonly<Record<keyof typeof RU, string>> = {
  early: "too early",
  wait: "can wait",
  good: "good moment to /compact",
  score: "score {n} of 100",
  unread: "context size not known yet",
  small: "context is small ({k})",
  agentsOne: "{n} agent running",
  agentsFew: "{n} agents running",
  agentsMany: "{n} agents running",
  callsSingle: "a background task is running",
  callsOne: "{n} background tasks are running",
  callsFew: "{n} background tasks are running",
  callsMany: "{n} background tasks are running",
  leftovers: "leftovers: {text}",
  size: "context {k}",
  share: " ({n}%)",
  leftoversNone: "no leftovers",
  leftoversUnknown: "leftovers unknown",
  goal: "goal reached with {n}% probability",
  goalPending: "checking whether the goal is reached",
  cacheWarm: "cache warm",
  cacheCold: "cache cold",
  backgroundUnknown: "background tasks unknown",
  alert: "context {n}% — time to compact",
  partFill: "context fill",
  partLeftovers: "leftovers",
  partP1: "goal reached",
  partCache: "cache",
  goalNotCounted:
    "- goal reached: not counted (weight removed, the rest rescaled)",
  leftoversIgnored:
    "- leftovers: not counted by setting (weight removed, the rest rescaled)",
  capBackground:
    "- capped at 60: background tasks unknown (no agent-shell-watch)",
  capLeftovers: "- capped at 60: the last answer has no leftover lines",
  gate: "- too early",
  alertNote:
    "- alert: context {n}% is at or above {limit}%; /compact is suggested at turn end",
  guardOn: "Every /compact and auto-compaction gets the preservation template.",
  guardOff: "Compaction guard off: /compact runs as typed.",
  disclaimer: "A score, not a probability: nothing here is calibrated.",
};

/** The phrase names every language has. */
export type Phrase = keyof typeof RU;

const HOLE = /\{(\w+)\}/gu;

const TABLES: Readonly<Record<Language, Readonly<Record<Phrase, string>>>> = {
  ru: RU,
  en: EN,
};

/**
 * One phrase with its holes filled.
 * @param language the table to read
 * @param phrase the phrase's name
 * @param holes what goes in each `{name}`
 * @returns the text
 */
export const say = (
  language: Language,
  phrase: Phrase,
  holes: Readonly<Record<string, number | string>> = {},
): string =>
  TABLES[language][phrase].replaceAll(HOLE, (_hole, name: string) =>
    String(holes[name] ?? ""),
  );

const RU_FORMS: Readonly<Record<number, "One" | "Few">> = {
  1: "One",
  2: "Few",
  3: "Few",
  4: "Few",
};
const MOD_TEN = 10;
const MOD_HUNDRED = 100;
const TEEN_MIN = 11;
const TEEN_MAX = 14;

/**
 * The plural form a count takes: ru has one (1, 21), few (2-4) and many.
 * @param language the table's language
 * @param count how many
 * @returns the suffix of a three-form phrase
 */
export const formOf = (
  language: Language,
  count: number,
): "One" | "Few" | "Many" => {
  const tail = count % MOD_HUNDRED;
  const isTeen = tail >= TEEN_MIN && tail <= TEEN_MAX;
  const ru = isTeen ? "Many" : (RU_FORMS[count % MOD_TEN] ?? "Many");
  const en = count === 1 ? "One" : "Many";
  return language === "ru" ? ru : en;
};
