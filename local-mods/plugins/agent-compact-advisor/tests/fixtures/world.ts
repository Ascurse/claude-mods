import type { AgentInfo, On } from "claude-code";

// A promise that never settles: Boolean is a non-empty executor that ignores it.
const NEVER = new Promise<never>(Boolean);

/** What the mocked world beneath the plugin saw, and what it answers. */
export interface World {
  readonly statuses: (string | undefined)[];
  readonly toasts: string[];
  readonly suggested: string[];
  /** The instructions each compaction reached the engine with. */
  readonly compactions: (string | undefined)[];
  /** The bodies posted to System One. */
  readonly posts: string[];
  /** Kev's P1 answer, undefined for Kev down, "hang" for no answer ever. */
  kev: number | "hang" | undefined;
  agents: AgentInfo[];
  /** agent-shell-watch's calls, undefined when it is not installed. */
  calls: { status: string }[] | undefined;
}

/**
 * Answers every engine call agent-compact-advisor makes besides the clock.
 * @param on the test's registrar
 * @returns the world, to assert on and to steer
 */
export const world = (on: On): World => {
  const seen: World = {
    statuses: [],
    toasts: [],
    suggested: [],
    compactions: [],
    posts: [],
    kev: 0.9,
    agents: [],
    calls: undefined,
  };
  on("state.get", { plugin: "agent-shell-watch" }, () => ({
    value:
      seen.calls === undefined
        ? { value: undefined, version: 0 }
        : { value: seen.calls, version: 1 },
  }));
  on("session.start", (_$, e) => ({ cwd: e.cwd }));
  on("command.register", (_$, e) => ({ value: { command: e.name } }));
  on("ui.status", (_$, e) => {
    seen.statuses.push(e.text);
    return { value: undefined };
  });
  on("ui.toast", (_$, e) => {
    seen.toasts.push(e.text);
    return { value: undefined };
  });
  on("prompt.suggest", (_$, e) => {
    seen.suggested.push(e.text);
    return { isShown: true };
  });
  on("agent.list", () => ({ value: seen.agents }));
  on("http.fetch", async (_$, e) => {
    seen.posts.push(e.init?.body ?? "");
    if (seen.kev === "hang") {
      await NEVER;
    } else if (seen.kev === undefined) {
      throw new Error("ECONNREFUSED");
    }
    return {
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({
          answers: { done: { type: "noul", noul: seen.kev } },
        }),
      },
    };
  });
  on("session.measure", (_$, e) => ({ changed: e.changed }));
  on("turn.complete", (_$, e) => ({ text: e.answer }));
  on("session.compact", (_$, e) => {
    seen.compactions.push(e.instructions);
    return {
      messages: [{ role: "assistant", text: "summary", toolUses: [] }],
      tokensBefore: 300_000,
      tokensAfter: 20_000,
    };
  });
  return seen;
};
