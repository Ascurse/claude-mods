import { expect, test } from "claude-code/testing";

import { configOf } from "../../hooks/model/config.ts";
import {
  type Drawn,
  explanationOf,
  isAlertOf,
  statusLineOf,
  summaryOf,
} from "../../hooks/model/format.ts";
import type { Gate, Verdict } from "../../hooks/model/score.ts";
import type { AdvisorFacts } from "../../types";

const FACTS: AdvisorFacts = {
  tokens: 312_400,
  percent: 62,
  leftovers: { kind: "none" },
  p1: { kind: "value", value: 0.912 },
  wasAbove: false,
  wasAlerted: false,
};
const PARTS: Verdict["parts"] = [
  { name: "fill", weight: 40, value: 1 },
  { name: "leftovers", weight: 30, value: 1 },
  { name: "P1", weight: 20, value: 0.91 },
  { name: "cache", weight: 10, value: 1 },
];
const RU = configOf({ alertPercent: 0 });
const EN = configOf({ language: "en", alertPercent: 0 });
const drawn = (over: Partial<Drawn> = {}): Drawn => ({
  verdict: { score: 82, parts: PARTS, caps: [] },
  facts: FACTS,
  isCacheWarm: true,
  isBackgroundKnown: true,
  config: RU,
  ...over,
});
const gated = (gate: Gate, over: Partial<Drawn> = {}): Drawn =>
  drawn({ verdict: { score: 0, gate, parts: [], caps: [] }, ...over });
const SMALL: AdvisorFacts = { ...FACTS, tokens: 243_000, percent: 24 };

test("ready: the good moment, the score and every signal in words", () => {
  expect(summaryOf(drawn())).toBe(
    "хороший момент для /compact: оценка 82 из 100 · контекст 312k (62%) · хвостов нет · цель достигнута с вероятностью 91% · кэш тёплый",
  );
  expect(summaryOf(drawn({ config: EN }))).toBe(
    "good moment to /compact: score 82 of 100 · context 312k (62%) · no leftovers · goal reached with 91% probability · cache warm",
  );
});

test("below the threshold without a gate: can wait; unknowns in words", () => {
  expect(
    summaryOf(
      drawn({
        verdict: { score: 55, parts: PARTS, caps: ["background"] },
        facts: { ...FACTS, p1: { kind: "pending" } },
        isCacheWarm: false,
        isBackgroundKnown: false,
      }),
    ),
  ).toBe(
    "можно подождать: оценка 55 из 100 · контекст 312k (62%) · хвостов нет · проверяю, достигнута ли цель · кэш остыл · фоновые задачи неизвестны",
  );
});

test("a gate says why it is early, with the size where it is not the reason", () => {
  expect(
    summaryOf(gated({ kind: "calls", count: 1 }, { facts: SMALL })),
  ).toBe("рано: идёт фоновая задача · контекст 243k (24%)");
  expect(summaryOf(gated({ kind: "agents", count: 2 }))).toBe(
    "рано: работает 2 агента · контекст 312k (62%)",
  );
  expect(
    summaryOf(gated({ kind: "leftovers", text: "push" }, { facts: SMALL })),
  ).toBe("рано: хвосты — push · контекст 243k (24%)");
  expect(summaryOf(gated({ kind: "small", tokens: 50_000 }))).toBe(
    "рано: контекст мал (50k)",
  );
  expect(summaryOf(gated({ kind: "unread" }))).toBe(
    "рано: размер контекста ещё неизвестен",
  );
  expect(summaryOf(gated({ kind: "agents", count: 5 }))).toContain(
    "работают 5 агентов",
  );
  expect(summaryOf(gated({ kind: "calls", count: 3 }, { config: EN }))).toBe(
    "too early: 3 background tasks are running · context 312k (62%)",
  );
});

test("ignored leftovers say nothing about leftovers", () => {
  const line = summaryOf(
    drawn({
      facts: { ...FACTS, leftovers: { kind: "listed", text: "wait" } },
      config: configOf({ ignoreLeftovers: true, alertPercent: 0 }),
    }),
  );
  expect(line).not.toContain("хвост");
});

test("the status line is short: the score or why it is early, then the size", () => {
  expect(statusLineOf(drawn())).toBe("/compact 82 · 312k 62%");
  expect(statusLineOf(drawn({ config: EN }))).toBe("/compact 82 · 312k 62%");
  expect(statusLineOf(gated({ kind: "agents", count: 2 }))).toBe(
    "/compact рано · работает 2 агента · 312k 62%",
  );
  expect(statusLineOf(gated({ kind: "small", tokens: 50_000 }))).toBe(
    "/compact рано · контекст мал (50k)",
  );
  expect(statusLineOf(gated({ kind: "unread" }))).toBe(
    "/compact рано · размер контекста ещё неизвестен",
  );
  expect(statusLineOf(gated({ kind: "calls", count: 3 }, { config: EN }))).toBe(
    "/compact too early · 3 background tasks are running · 312k 62%",
  );
});

test("past the alert percent the line stays short, with no alert words", () => {
  const alerting = configOf({ alertPercent: 60 });
  expect(statusLineOf(drawn({ config: alerting }))).toBe("/compact 82 · 312k 62%");
  expect(summaryOf(drawn({ config: alerting }))).not.toContain("пора компактить");
  expect(isAlertOf(FACTS, alerting)).toBe(true);
  expect(isAlertOf({ ...FACTS, percent: 59 }, alerting)).toBe(false);
  expect(isAlertOf({ ...FACTS, percent: undefined }, alerting)).toBe(false);
  expect(isAlertOf(FACTS, RU)).toBe(false);
});

test("the explanation lists parts, caps and the guard, in the language", () => {
  const capped = drawn({
    verdict: {
      score: 60,
      parts: PARTS.filter((part) => part.name !== "P1"),
      caps: ["leftovers"],
    },
    facts: { ...FACTS, p1: { kind: "na" } },
  });
  const ru = explanationOf(capped, true);
  expect(ru).toContain("- заполнение: 1.00 × 40");
  expect(ru).toContain("- цель достигнута: не учитывается");
  expect(ru).toContain("- потолок 60: в последнем ответе нет строк о хвостах");
  expect(ru).toContain("шаблон сохранения");
  const en = explanationOf({ ...capped, config: EN }, true);
  expect(en).toContain("- context fill: 1.00 × 40");
  expect(en).toContain("- capped at 60: the last answer has no leftover lines");
  expect(en).toContain("not a probability");
  expect(explanationOf(gated({ kind: "agents", count: 1 }), false)).toContain(
    "- рано: работает 1 агент",
  );
});

test("the explanation notes ignored leftovers and the alert", () => {
  const text = explanationOf(
    drawn({ config: configOf({ ignoreLeftovers: true, alertPercent: 60 }) }),
    true,
  );
  expect(text).toContain("- хвосты: не учитываются по настройке");
  expect(text).toContain("- тревога: контекст 62% не ниже порога 60%");
});
