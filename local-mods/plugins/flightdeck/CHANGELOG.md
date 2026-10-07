# Changelog

## 0.6.1

- `run` no longer spawns the agent itself. In auto mode the engine does not call a plugin's own hooks on its own `$.agent.spawn`, so the permission workaround from 0.6.0 never ran and the classifier still refused. `run` (and the queued agents of next mode) now sends the main model one request through `$.prompt.submit`: start these subagents with the Agent tool, in the background, with each task text verbatim. The model makes the Agent call, so the classifier sees a request. The row is `started` once the request is submitted; the agent card appears when the model starts it.
- Removed the permission workaround (`ownSpawns`, `ownSpawnIndex`, `ownVerdict`); `tool.check` only records checks now.

## 0.6.0

- Crew has two modes. **now**, as before: the crew is picked for the prompt you just sent, and `run` starts an agent beside the main work. **next**, new: when a turn ends and Claude Code guesses your next prompt (the dim suggestion in the prompt box), the crew is picked for that guess. Each row has a `next` button that queues the agent (`queued`; press again to take it off). When you send your next prompt, Haiku writes each queued agent's task from that real prompt, not from the guess, and the agent starts; the panel goes back to now. Taking the guess word for word starts the queue too. A guess never replaces a draft you have open or a queue you already made. With prompt suggestions turned off there is no next list.
- `run` works in auto mode. The server-side classifier refused the spawn because the prompt never asked for an agent; it does not see the button press. While flightdeck's own spawn runs, its permission hook now answers `allow` for exactly that Agent call (flightdeck as the caller, the same agent type and the same task text, once). A settings rule for Agent, deny or ask, still decides, and every other Agent call goes to the classifier as before.
- `bun scripts/readme-draft.ts` checks that the README's example of the `run` request matches `draftRequest` in `hooks/crew.ts` and fails if it doesn't; `--write` refreshes the example. The repo's pre-commit hook runs it when either file is staged. The plugin itself is unchanged.
- The pre-commit hook checks the staged versions of the plugin's files, not the working tree, so a partly staged file is checked exactly as it will be committed.
- The check's logic lives in `scripts/readme-draft-core.ts` and is covered by `tests/readme-draft.test.ts`; `tsc` now type-checks `scripts/` too.
- Removed stale compiled `.js` copies from `hooks/` and `tests/`; Claude Code loads `register.tsx` directly.

## 0.5.0

- The README shows a crew row with its short draft, the exact request `run` sends to Haiku, and an example of the full prompt that opens with those steps.
- Tests cover how the short draft reaches that request: an empty or blank one adds nothing, nested steps arrive as one line in order, and a draft longer than 160 characters is cut to 160.

## 0.4.5

- `run` now sends the short draft shown under the agent name to Haiku together with the one-line task, so the full prompt starts with the same first steps the row promised. Still one Haiku call per `run`; a row without a short draft sends nothing extra.

## 0.4.4

- Before `run`, each crew row shows a short draft under the agent name: one dim line of at most 160 characters, cut to the pane width, on how the agent would start. It comes from the same single Haiku call as the one-line tasks, so the number of calls does not change; the draft written by `run` replaces it. If Haiku fails or answers without drafts, the row keeps its name and task line and simply has no draft line. The task cache moves to a new key, so tasks cached by 0.4.3 are asked again once. Checked live in the desktop app as well as in the tests for terminal and desktop.

## 0.4.3

- Crew rows no longer reveal the agent's description on hover: on desktop the pointer rests over the pane, so the card covered the task line. A row whose task never came says `нет задачи` instead of staying blank.

## 0.4.2

- The one-line task cache is keyed by the project folder too, so the same prompt in another project asks Haiku again instead of showing the old project's tasks.

## 0.4.1

- The crew panel now fills on the first prompt after a reload: when the agent listing arrives after the prompt, the pick runs once the turn ends.

## 0.4.0

- New **crew** panel: on each prompt, Jev picks the 5 agents that fit it from every agent the session offers; word match takes over when Jev is missing or fails, and the header says which.
- `run` has Haiku write the agent's prompt from your request; `start`, `edit` and `drop` act on the draft. `crewRun: direct` spawns without the draft.
- Topic tags: Haiku tags the catalog once per catalog (kept in `$.store`), Jev picks the tags of your prompt, and the panel shows only agents carrying one (`5 of 38 · jev · frontend, testing`). Without tags it behaves as before.
- Jev answers are cached in `$.store` (50 entries), so a repeated prompt, even in a new session, does not call Jev.
- Beside each agent name: Haiku's one-line task for your request (one call for all 5, cached, written in the background); the description shows on hover.
- `run` is a framed primary button. The prompt stays on the row in full after `start`, dim.
- `edit` opens a focused pane with the draft: Enter saves it (and keeps the last 10 edits per agent), Escape leaves it as it was. It replaces the old fill of the prompt box.
- `crew` joins the default `panels`. README: what the crew panel runs and sends.

## 0.3.2

- A background architect's advice is read from its `SubagentHandback` tool call, where the report actually arrives, with the hand-back text as a fallback. Bold markers no longer leak into the advice line.
- README: no longer promises that counters survive every update; a change to the state's shape may reset them once.

## 0.3.1

- The main box shows the model and effort as soon as a request starts, not after the first one finishes.
- Advice from a background architect agent (such as `fable-advisor`) now reaches the architect's `»` line; it arrives as a hand-back message, not as the agent's own answer.
- New README media showing the Flightdeck header; plainer wording about opening on start.
- More gate tests (24 in all).

## 0.3.0

First public release.

- Panels: main vitals (context, compactions, cost, rate limits), architect timeline, permission gate strip with per-family drill-down, agent cards and swimlanes, other loops, turn receipt, session log.
- Layouts: docked one- or two-column, and an 8-row inline summary for the main screen. Cards fall back to swimlanes when they don't fit.
- Theme colours by default, with a `pastel` palette option.
- Animated connectors and live clocks as surface modules, only while work flows.
- Works on the terminal, desktop app, VS Code and mobile surfaces.
- Config for the architect pattern, labels, panels, layout, card limit, motion, moments, palette, opening on start and the status line.
- `/clear` and `/flightdeck reset` start the pane fresh; reads tolerate missing or older fields.
