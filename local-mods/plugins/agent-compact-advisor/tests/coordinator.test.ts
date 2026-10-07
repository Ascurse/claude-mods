import { expect, mock, test } from "claude-code/testing";

import { advance } from "./fixtures/advance.ts";
import { DONE, measure, MESSAGES, START, turn } from "./fixtures/session.ts";
import { world } from "./fixtures/world.ts";

const COORDINATOR =
  "Идёт работа.\nХвосты для агента: ждать итоги субагентов\nХвосты для владельца: нет";

test("a listed leftover scores 0 for a plain session, with the size shown", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.calls = [];
  await $.session.start(START);
  await measure($, 240_000);
  await turn($, COORDINATOR);
  await advance(clock, 0);
  expect(seen.statuses.at(-1)).toBe(
    "/compact рано · хвосты — ждать итоги субагентов · 240k 24%",
  );
});

test(
  "ignoreLeftovers keeps a coordinator's score alive",
  { options: { ignoreLeftovers: true } },
  async ($, on) => {
    const clock = mock.clock(on);
    const seen = world(on);
    seen.calls = [];
    await $.session.start(START);
    await measure($, 400_000);
    await turn($, COORDINATOR);
    await advance(clock, 0);
    expect(seen.statuses.at(-1)).toBe(
      "/compact 97 · 400k 40%",
    );
    expect(seen.suggested.at(-1)).toMatch(/^\/compact/u);
  },
);

test(
  "the status line speaks English when asked",
  { options: { language: "en" } },
  async ($, on) => {
    const clock = mock.clock(on);
    const seen = world(on);
    seen.calls = [{ status: "running" }];
    await $.session.start(START);
    await measure($, 400_000);
    await turn($, DONE);
    await advance(clock, 0);
    expect(seen.statuses.at(-1)).toBe(
      "/compact too early · a background task is running · 400k 40%",
    );
  },
);

test("the size alert fires past 60% whatever the leftovers, once per crossing", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.calls = [];
  await $.session.start(START);
  await measure($, 650_000);
  await turn($, COORDINATOR);
  await advance(clock, 0);
  expect(seen.statuses.at(-1)).toBe(
    "/compact рано · хвосты — ждать итоги субагентов · 650k 65%",
  );
  expect(seen.suggested).toHaveLength(1);
  expect(seen.toasts).toEqual([]);
  await measure($, 700_000);
  expect(seen.toasts).toEqual([]);
  await $.session.compact({ messages: MESSAGES, trigger: "manual" });
  await measure($, 650_000);
  expect(seen.toasts).toEqual([]);
});

test(
  "alertPercent 0 turns the alert off",
  { options: { alertPercent: 0 } },
  async ($, on) => {
    const clock = mock.clock(on);
    const seen = world(on);
    seen.calls = [];
    await $.session.start(START);
    await measure($, 650_000);
    await turn($, COORDINATOR);
    await advance(clock, 0);
    expect(seen.statuses.at(-1)).not.toContain("пора компактить");
    expect(seen.suggested).toEqual([]);
    expect(seen.toasts).toEqual([]);
  },
);

test("the size alert shows but offers no /compact while background work runs", async ($, on) => {
  const clock = mock.clock(on);
  const seen = world(on);
  seen.calls = [{ status: "running" }];
  await $.session.start(START);
  await measure($, 650_000);
  await turn($, DONE);
  await advance(clock, 0);
  expect(seen.statuses.at(-1)).toBe(
    "/compact рано · идёт фоновая задача · 650k 65%",
  );
  expect(seen.toasts).toEqual([]);
  expect(seen.suggested).toHaveLength(0);
});
