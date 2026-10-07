import type { SessionMessage } from "claude-code";
import type { Engine } from "claude-code/testing";

/** The session start every test opens with. */
export const START = {
  cwd: "/w",
  surface: "terminal",
  isInteractive: true,
} as const;
export const MESSAGES: SessionMessage[] = [
  { role: "user", text: "build it", toolUses: [] },
];
export const DONE =
  "Shipped.\nХвосты для агента: нет\nХвосты для владельца: нет";

export const measure = async ($: Engine, tokens: number): Promise<void> => {
  await $.session.measure({
    context: {
      tokens,
      window: 1_000_000,
      percent: Math.round(tokens / 10_000),
    },
    rateLimits: [],
    changed: ["context"],
  });
};

export const turn = async ($: Engine, answer: string): Promise<void> => {
  await $.turn.complete({
    answer,
    durationMs: 1000,
    isAborted: false,
    turnId: "t1",
    reason: "answer",
  });
};
