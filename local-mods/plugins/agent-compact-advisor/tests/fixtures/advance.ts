import type { MockClock } from "claude-code/testing";

const ROUNDS = 5;

const settle = async (clock: MockClock, left: number): Promise<void> => {
  if (left <= 0) {
    return;
  }
  await clock.settle();
  await settle(clock, left - 1);
};

/**
 * Moves the mocked clock on, then lets what the timers started finish: each
 * settle runs the dispatches already under way without moving the clock, so
 * an assertion reads their result however slowly the machine schedules them.
 * @param clock the test's mocked clock
 * @param ms how far to move it
 */
export const advance = async (clock: MockClock, ms: number): Promise<void> => {
  await clock.advance(ms);
  await settle(clock, ROUNDS);
};
