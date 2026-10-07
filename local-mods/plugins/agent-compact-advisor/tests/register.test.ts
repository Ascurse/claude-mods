import { expect, mock, test } from "claude-code/testing";

import { TEMPLATE } from "../hooks/model/template.ts";
import { advance } from "./fixtures/advance.ts";
import { DONE, measure, MESSAGES, START, turn } from "./fixtures/session.ts";
import { world } from "./fixtures/world.ts";

const RUN = {
  command: "compact-advisor",
  args: "",
  origin: { kind: "composer" },
  presentation: { isFullscreen: true, columns: 160 },
} as const;
test("a big, finished session scores high, suggests /compact without a toast", async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 });
  const seen = world(on);
  seen.calls = [{ status: "done" }];
  await $.session.start(START);
  await measure($, 400_000);
  await turn($, DONE);
  await advance(clock, 0);
  expect(seen.statuses.at(-1)).toBe(
    "/compact 98 · 400k 40%",
  );
  expect(seen.suggested.at(-1)).toMatch(/^\/compact Keep the goal/u);
  expect(seen.toasts).toEqual([]);
  expect(JSON.parse(seen.posts[0] ?? "{}")).toMatchObject({
    model: "kev-latest",
    state: DONE,
  });
  await measure($, 410_000);
  expect(seen.toasts).toEqual([]);
});

test("running agents gate the score to 0 and nothing is suggested", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.agents = [
    { id: "a1", description: "review", type: "Explore", status: "running" },
  ];
  seen.calls = [];
  await $.session.start(START);
  await measure($, 400_000);
  await turn($, DONE);
  await advance(clock, 0);
  expect(seen.statuses.at(-1)).toBe(
    "/compact рано · работает 1 агент · 400k 40%",
  );
  expect(seen.suggested).toEqual([]);
});

test("without agent-shell-watch and with Kev down the score stays capped", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.kev = undefined;
  await $.session.start(START);
  await measure($, 400_000);
  await turn($, DONE);
  await advance(clock, 0);
  expect(seen.statuses.at(-1)).toBe(
    "/compact 60 · 400k 40%",
  );
  expect(seen.suggested).toEqual([]);
});

test("listed leftovers are a gate and Kev is not asked", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.calls = [];
  await $.session.start(START);
  await measure($, 400_000);
  await turn($, "Хвосты для агента: нет\nХвосты для владельца: push");
  await advance(clock, 0);
  expect(seen.statuses.at(-1)).toBe(
    "/compact рано · хвосты — push · 400k 40%",
  );
  expect(seen.posts).toEqual([]);
});

test("the cache going cold redraws without its part", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.calls = [];
  await $.session.start(START);
  await measure($, 400_000);
  await turn($, DONE);
  await advance(clock, 0);
  await advance(clock, 301_000);
  expect(seen.statuses.at(-1)).toBe(
    "/compact 88 · 400k 40%",
  );
});

test("every main compaction gets the template; others pass untouched", async ($, on) => {
  mock.clock(on);
  const seen = world(on);
  await $.session.start(START);
  await $.session.compact({ messages: MESSAGES, trigger: "manual" });
  await $.session.compact({
    messages: MESSAGES,
    trigger: "manual",
    instructions: "keep API notes",
  });
  await $.session.compact({ messages: MESSAGES, trigger: "auto" });
  await $.session.compact({ messages: MESSAGES, trigger: "precompute" });
  expect(seen.compactions).toEqual([
    TEMPLATE,
    `keep API notes\n\n${TEMPLATE}`,
    TEMPLATE,
    undefined,
  ]);
});

test("a compaction resets the size so a stale score does not stay", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.calls = [];
  await $.session.start(START);
  await measure($, 400_000);
  await turn($, DONE);
  await advance(clock, 0);
  await $.session.compact({ messages: MESSAGES, trigger: "manual" });
  const answer = await $.command.run(RUN);
  expect(answer.text).toContain("рано: контекст мал (20k)");
  expect(seen.compactions).toHaveLength(1);
});

test("/compact-advisor explains the score", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.calls = [];
  await $.session.start(START);
  await measure($, 400_000);
  await turn($, DONE);
  await advance(clock, 0);
  const answer = await $.command.run(RUN);
  expect(answer.text).toContain("- цель достигнута: 0.90 × 20");
  expect(answer.text).toContain("шаблон сохранения");
});

test(
  "a guard switched off leaves compactions as typed",
  { options: { guardCompactions: false } },
  async ($, on) => {
    mock.clock(on);
    const seen = world(on);
    await $.session.start(START);
    await $.session.compact({ messages: MESSAGES, trigger: "manual" });
    expect(seen.compactions).toEqual([undefined]);
  },
);

test("a Kev that never answers times out to P1 n/a", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.kev = "hang";
  seen.calls = [];
  await $.session.start(START);
  await measure($, 400_000);
  await turn($, DONE);
  await advance(clock, 0);
  expect((await $.command.run(RUN)).text).toContain("проверяю, достигнута ли цель");
  await advance(clock, 20_000);
  expect(seen.statuses.at(-1)).toBe(
    "/compact 100 · 400k 40%",
  );
});

test("a reload turns a P1 left pending into n/a", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.kev = "hang";
  seen.calls = [];
  await $.session.start(START);
  await measure($, 400_000);
  await turn($, DONE);
  await advance(clock, 0);
  await $.session.start(START);
  expect((await $.command.run(RUN)).text).not.toContain("проверяю");
});

test("an agent finishing between turns is seen within 30 s and offers once", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.calls = [];
  seen.agents = [
    { id: "a1", description: "review", type: "Explore", status: "running" },
  ];
  await $.session.start(START);
  await measure($, 400_000);
  await turn($, DONE);
  await advance(clock, 0);
  expect(seen.suggested).toEqual([]);
  seen.agents = [];
  await advance(clock, 30_000);
  expect(seen.statuses.at(-1)).toMatch(
    /^\/compact 98 /u,
  );
  expect(seen.suggested).toHaveLength(1);
  await advance(clock, 30_000);
  expect(seen.suggested).toHaveLength(1);
});

test("after a reload the cache still goes cold on time", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.calls = [];
  await $.session.start(START);
  await measure($, 400_000);
  await turn($, DONE);
  await advance(clock, 0);
  await $.session.start(START);
  await advance(clock, 330_000);
  expect((await $.command.run(RUN)).text).toContain("кэш остыл");
});
