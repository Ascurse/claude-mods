/** What the last answer's leftover lines say. */
export type Leftovers =
  | { readonly kind: "none" }
  | { readonly kind: "unknown" }
  | { readonly kind: "listed"; readonly text: string };

/** Kev's P1 for the last answer: a value, being asked, or not available. */
export type P1 =
  | { readonly kind: "value"; readonly value: number }
  | { readonly kind: "pending" }
  | { readonly kind: "na" };

/** What the advisor knows of the session, kept across a hot reload. */
export interface AdvisorFacts {
  readonly tokens?: number | undefined;
  readonly window?: number | undefined;
  readonly percent?: number | undefined;
  readonly leftovers: Leftovers;
  readonly p1: P1;
  readonly turnId?: string;
  readonly lastTurnAt?: number;
  /** Whether the last score drawn stood at the threshold or above. */
  readonly wasAbove: boolean;
  /** Whether the context share stood at the alert percent or above. */
  readonly wasAlerted: boolean;
}

/** The slice of an agent-shell-watch call the advisor reads. */
export interface WatchedCall {
  readonly status: string;
}

declare module "claude-code" {
  interface PluginState {
    "agent-compact-advisor": {
      facts: AdvisorFacts;
    };
    "agent-shell-watch": {
      calls: readonly WatchedCall[];
    };
  }
}
