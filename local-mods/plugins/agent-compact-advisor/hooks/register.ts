/**
 * agent-compact-advisor: a status-line score for how good a moment it is to
 * `/compact`, a ready one-line `/compact` suggested past the threshold, and
 * the preservation template added to every compaction of the main
 * conversation. It never compacts and never cancels a compaction.
 */
import type {
  EngineInterface,
  Next,
  Register,
  SessionCompactInput,
  SessionCompactResult,
  SessionContextUsage,
  TurnCompleteInput,
} from "claude-code";
import { atom, read, update } from "claude-code";

import type { AdvisorFacts } from "../types";
import { type Config, configOf } from "./model/config.ts";
import { type Drawn, explanationOf, statusLineOf } from "./model/format.ts";
import { kevBodyOf, noulOf } from "./model/kev.ts";
import { leftoversOf } from "./model/leftovers.ts";
import { offerOf } from "./model/offer.ts";
import { isCacheWarm, scoreOf, type Signals } from "./model/score.ts";
import { SUGGESTION, withTemplate } from "./model/template.ts";

type Engine = Readonly<EngineInterface>;

const COMMAND = "compact-advisor";
const INITIAL: AdvisorFacts = {
  leftovers: { kind: "unknown" },
  p1: { kind: "na" },
  wasAbove: false,
  wasAlerted: false,
};
const factsAtom = atom(
  { plugin: "agent-compact-advisor", key: "facts" } as const,
  INITIAL,
);
const watchCalls = { plugin: "agent-shell-watch", key: "calls" } as const;
const LIVE = new Set(["running", "quiet", "hung"]);
// Agents and background calls end between turns, and the cache goes cold:
// a slow redraw sees it; it outlives no reload, as session.start starts it.
const REDRAW_MS = 30_000;
// $.http.fetch has no timeout of its own; Kev's cold start takes seconds.
const KEV_TIMEOUT_MS = 20_000;

const timedOut = async ($: Engine): Promise<undefined> => {
  await $.clock.sleep(KEV_TIMEOUT_MS);
  return undefined;
};

// P1 for the answer, or undefined when Kev is off, down, slow or unclear.
const askKev = async (
  $: Engine,
  config: Config,
  answer: string,
): Promise<number | undefined> => {
  if (config.kevUrl === undefined) {
    return undefined;
  }
  try {
    const response = await Promise.race([
      $.http.fetch(`${config.kevUrl}/v1/systemone`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: kevBodyOf(config.kevModel, answer),
      }),
      timedOut($),
    ]);
    return response?.ok === true
      ? noulOf(JSON.parse(response.text) as unknown)
      : undefined;
  } catch {
    return undefined;
  }
};

// agent-shell-watch writes its calls at every session start: a value never
// written means it is not installed, so background work is unknown.
const liveCallsOf = async ($: Engine): Promise<number | undefined> => {
  try {
    const { value, version } = await $.state.get(watchCalls);
    return version === 0 || value === undefined
      ? undefined
      : value.filter((call) => LIVE.has(call.status)).length;
  } catch {
    return undefined;
  }
};

const runningAgentsOf = async ($: Engine): Promise<number> => {
  try {
    const agents = await $.agent.list();
    return agents.filter((agent) => agent.status === "running").length;
  } catch {
    return 0;
  }
};

const signalsOf = async ($: Engine): Promise<Signals> => ({
  facts: await read($, factsAtom),
  runningAgents: await runningAgentsOf($),
  liveCalls: await liveCallsOf($),
  now: await $.clock.now(),
});

const drawnOf = async ($: Engine, config: Config): Promise<Drawn> => {
  const signals = await signalsOf($);
  return {
    verdict: scoreOf(signals, config),
    facts: signals.facts,
    isCacheWarm: isCacheWarm(signals, config),
    isBackgroundKnown: signals.liveCalls !== undefined,
    config,
  };
};

// Timer work outlives its dispatch: after a reload or the session's end its
// environment is gone and every $ call it still makes is refused.
const quietly = async (work: Promise<void>): Promise<void> => {
  try {
    await work;
  } catch {
    // Nothing to tell: the session it would have drawn for is gone.
  }
};

const draw = async (
  $: Engine,
  config: Config,
  isTurnEnd: boolean,
): Promise<void> => {
  const drawn = await drawnOf($, config);
  $.ui.status(config.statusLine ? statusLineOf(drawn) : undefined);
  const offer = offerOf(drawn, isTurnEnd);
  if (offer.isSuggested) {
    await $.prompt.suggest({ text: SUGGESTION });
  }
  if (offer.isChanged) {
    await update($, factsAtom, (facts): AdvisorFacts => ({
      ...facts,
      wasAbove: offer.isAbove,
      wasAlerted: offer.isAlerted,
    }));
  }
};

const settleP1 = async (
  $: Engine,
  config: Config,
  turn: Readonly<{ id: string; answer: string }>,
): Promise<void> => {
  await draw($, config, true);
  const value = await askKev($, config, turn.answer);
  await update($, factsAtom, (facts): AdvisorFacts =>
    facts.turnId === turn.id
      ? {
          ...facts,
          p1: value === undefined ? { kind: "na" } : { kind: "value", value },
        }
      : facts,
  );
  await draw($, config, true);
};

const onCompact = async (
  e: Readonly<SessionCompactInput>,
  next: Next<"session.compact">,
  config: Config,
): Promise<SessionCompactResult> => {
  const isGuarded =
    config.guardCompactions &&
    e.agentId === undefined &&
    (e.trigger === "manual" || e.trigger === "auto");
  return next(
    isGuarded ? { ...e, instructions: withTemplate(e.instructions) } : e,
  );
};

// session.start fires again on a hot reload, which dropped the timers: the
// redraw starts again, and a P1 still pending would never settle.
const start = async ($: Engine, config: Config): Promise<void> => {
  await $.command.register({
    name: COMMAND,
    description: "Explain the current /compact score and its signals",
    immediate: true,
  });
  await update($, factsAtom, (facts): AdvisorFacts =>
    facts.p1.kind === "pending" ? { ...facts, p1: { kind: "na" } } : facts,
  );
  $.clock.every(REDRAW_MS, () => {
    void quietly(draw($, config, false));
  });
  await draw($, config, false);
};

const noteMeasure = async (
  $: Engine,
  config: Config,
  context: Readonly<SessionContextUsage>,
): Promise<void> => {
  await update($, factsAtom, (facts): AdvisorFacts => ({
    ...facts,
    tokens: context.tokens,
    window: context.window,
    percent: context.percent,
  }));
  await draw($, config, false);
};

const noteTurn = async (
  $: Engine,
  config: Config,
  e: Readonly<TurnCompleteInput>,
): Promise<void> => {
  const leftovers = leftoversOf(e.answer, config.leftovers);
  const isAsked =
    config.kevUrl !== undefined &&
    e.reason === "answer" &&
    (config.ignoreLeftovers || leftovers.kind !== "listed");
  const now = await $.clock.now();
  await update($, factsAtom, (facts): AdvisorFacts => ({
    ...facts,
    leftovers,
    p1: { kind: isAsked ? "pending" : "na" },
    turnId: e.turnId,
    lastTurnAt: now,
  }));
  // Out of the turn's dispatch: the answer shows at once, and the box is
  // free by the time a suggestion comes.
  $.clock.after(0, () => {
    void quietly(
      isAsked
        ? settleP1($, config, { id: e.turnId, answer: e.answer })
        : draw($, config, true),
    );
  });
};

// A compaction that stands resets the size, so a stale score does not stay.
const noteCompaction = async (
  $: Engine,
  config: Config,
  tokensAfter: number | undefined,
): Promise<void> => {
  await update($, factsAtom, (facts): AdvisorFacts => ({
    ...facts,
    tokens: tokensAfter,
    percent: undefined,
  }));
  await draw($, config, false);
};

/**
 * Wires agent-compact-advisor's hooks.
 * @param on the registrar
 * @param options the `userConfig` values
 */
export const register: Register = (on, options) => {
  const config = configOf(options);
  on("session.start", async ($, e, next) => {
    const started = await next(e);
    await start($, config);
    return started;
  });
  on("session.measure", async ($, e, next) => {
    const measured = await next(e);
    await noteMeasure($, config, e.context);
    return measured;
  });
  on("turn.complete", async ($, e, next) => {
    const completed = await next(e);
    if (e.agentId === undefined) {
      await noteTurn($, config, e);
    }
    return completed;
  });
  on("session.compact", async ($, e, next) => {
    const compacted = await onCompact(e, next, config);
    const isMain = e.agentId === undefined && e.trigger !== "precompute";
    if (isMain && compacted.skip === undefined) {
      await noteCompaction($, config, compacted.tokensAfter);
    }
    return compacted;
  });
  on("command.run", { command: COMMAND }, async ($) => ({
    text: explanationOf(await drawnOf($, config), config.guardCompactions),
  }));
};
