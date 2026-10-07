/**
 * What a redraw should tell the person: a suggestion and the new marks.
 */
import { type Drawn, isAlertOf } from "./format.ts";
import type { Verdict } from "./score.ts";

/** What one redraw does besides drawing the line. */
export interface Offer {
  readonly isSuggested: boolean;
  readonly isAbove: boolean;
  readonly isAlerted: boolean;
  /** Whether the remembered crossings changed. */
  readonly isChanged: boolean;
}

// Work still running: the alert shows, but no ready /compact to Tab into.
const isBusy = (gate: Verdict["gate"]): boolean =>
  gate?.kind === "agents" || gate?.kind === "calls";

/**
 * Decides a redraw's offers. The `/compact` is offered at a turn's end, or
 * when the score first crosses the threshold; a redraw never brings back a
 * suggestion the person dropped. The size alert is separate: it asks at turn
 * ends whatever the score or the leftovers, but not while agents or
 * background calls run.
 * @param drawn the verdict, the facts and the config
 * @param isTurnEnd whether the redraw follows a main turn's end
 * @returns what to do
 */
export const offerOf = (drawn: Drawn, isTurnEnd: boolean): Offer => {
  const { facts, verdict, config } = drawn;
  const isAbove = verdict.score >= config.threshold;
  const isAlerted = isAlertOf(facts, config);
  return {
    isSuggested:
      (isAbove && (isTurnEnd || !facts.wasAbove)) ||
      (isAlerted && isTurnEnd && !isBusy(verdict.gate)),
    isAbove,
    isAlerted,
    isChanged: isAbove !== facts.wasAbove || isAlerted !== facts.wasAlerted,
  };
};
