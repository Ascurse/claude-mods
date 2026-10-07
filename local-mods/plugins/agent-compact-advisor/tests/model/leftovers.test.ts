import { expect, test } from "claude-code/testing";

import { leftoversOf } from "../../hooks/model/leftovers.ts";

const RULE = {
  prefixes: ["Хвосты для агента:", "Хвосты для владельца:", "Leftovers:"],
  noneWords: ["нет", "none"],
} as const;

test("both owner lines saying нет are none, in any markup", () => {
  const answer = [
    "Done.",
    "- `Хвосты для агента: нет`",
    "> **Хвосты для владельца:** нет.",
  ].join("\n");
  expect(leftoversOf(answer, RULE)).toEqual({ kind: "none" });
});

test("a listed leftover wins and is carried, cut short", () => {
  const answer =
    "Хвосты для агента: нет\nХвосты для владельца: создать репозиторий на GitHub и подключить раннер к нему";
  expect(leftoversOf(answer, RULE)).toEqual({
    kind: "listed",
    text: "создать репозиторий на GitHub и подключ…",
  });
});

test("no line is unknown; the last line per prefix counts", () => {
  expect(leftoversOf("All done, tests pass.", RULE)).toEqual({
    kind: "unknown",
  });
  expect(
    leftoversOf("Leftovers: rerun CI\n...\nLeftovers: none", RULE),
  ).toEqual({ kind: "none" });
});

test("a none word inside a longer value is not none", () => {
  expect(leftoversOf("Хвосты для агента: нет, кроме CI", RULE)).toEqual({
    kind: "listed",
    text: "нет, кроме CI",
  });
});

test("a prefix mid-sentence does not count", () => {
  expect(
    leftoversOf("I will end with Хвосты для агента: нет as usual", RULE),
  ).toEqual({ kind: "unknown" });
});

test("list marks and bold around the prefix still count", () => {
  for (const owner of [
    "+ Хвосты для владельца: push",
    "1. Хвосты для владельца: push",
    "2) Хвосты для владельца: push",
    "**Хвосты для владельца**: push",
    "- _Хвосты для владельца:_ push",
  ]) {
    expect(leftoversOf(`Хвосты для агента: нет\n${owner}`, RULE)).toEqual({
      kind: "listed",
      text: "push",
    });
  }
});
