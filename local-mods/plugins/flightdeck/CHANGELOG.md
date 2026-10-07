# Changelog

## 0.4.4

- Before `run`, each crew row shows a short draft under the agent name: one dim line, cut to the pane width, on how the agent would start. It comes from the same single Haiku call as the one-line tasks, so the number of calls does not change; the draft written by `run` replaces it. The task cache moves to a new key, so tasks cached by 0.4.3 are asked again once.

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
