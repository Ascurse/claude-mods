# Flightdeck

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code 2.1.287+](https://img.shields.io/badge/Claude%20Code-2.1.287%2B%20mod-d97757.svg)](https://claude.com/blog/claude-code-mods)

**A Claude Code mod that puts a live agent dashboard in your terminal**: context and cost, an advisor timeline, every permission check, and your subagents as cards or swimlanes. Every number comes from a real session event, and nothing leaves your machine.

<p align="center">
  <img src="docs/media/demo.gif" alt="Flightdeck during a live session: five audit subagents fan out as cards, switch to swimlanes and finish, while the permission gate fills with checks" width="520">
</p>

<p align="center">
  <a href="#install">Install</a> · <a href="#what-you-see">What you see</a> · <a href="#what-it-can-reach">What it can reach</a> · <a href="#configure">Configure</a> · <a href="#troubleshooting">Troubleshooting</a>
</p>

## Install

Inside Claude Code (2.1.287 or later):

```
/plugin marketplace add scasella/claude-flightdeck
/plugin install flightdeck@claude-flightdeck
/reload-plugins
/flightdeck
```

<details>
<summary><strong>From the terminal, or from a clone</strong></summary>

```sh
claude plugin marketplace add scasella/claude-flightdeck
claude plugin install flightdeck@claude-flightdeck
```

Or load it straight from a clone, for one session:

```sh
git clone https://github.com/scasella/claude-flightdeck
claude --plugin-dir ./claude-flightdeck
```

</details>

The installer may say config options aren't set; the defaults are fine, and [`/config`](#configure) changes them.

Mods are an early-access Claude Code feature and their API can change between releases. If something breaks, see [Troubleshooting](#troubleshooting).

## What you see

https://github.com/user-attachments/assets/9ad0fcc3-c81c-427a-a743-f7b6c49f5885

<p align="center">
  <img src="docs/media/docked-session.png" alt="Claude Code in fullscreen with the Flightdeck pane docked beside the transcript" width="820">
</p>

| Docked beside the transcript | Inline above the prompt |
| --- | --- |
| <img src="docs/media/docked-pane.png" alt="The docked pane: main model vitals, architect timeline, permission gate, five agents as swimlanes, last-turn receipt and session log" width="380"> | <img src="docs/media/inline-mini.png" alt="The inline mini layout: the model, context gauge, session cost and architect consults; the permission gate strip and totals; the last turn's duration, agents, edits, errors and cost" width="420"><br><br>On the main screen, without fullscreen, the pane is a summary of at most 8 rows; up to 3 agents join it when the session has subagents. |

| Panel | Shows | From |
| --- | --- | --- |
| **main** | model, effort, permission mode, request count; a context gauge with compactions (⟲); cost and the first two rate-limit windows when your plan reports them | `turn.step`, `session.measure`, `session.compact`, `$.session.usage()` |
| **architect** | consults on a timeline, whether one is running, how long the last took; optionally the moment of each consult; the first line of a subagent architect's advice | a spawn of a matching agent type, or a matching server tool in the assistant's rows |
| **gate** | one cell per permission check: green allowed without asking, blue decided by the auto-mode classifier or you and then run, amber pending, red ✗ denied, dim if made inside a subagent. Totals, and a drill-down per tool family with credentials masked | `tool.check`, settled by the `tool.call` around it |
| **agents** | cards side by side while they fit: the task, type, live context and output tokens, steps, a running clock, `max_tokens` in red. Beyond that, swimlanes on one time axis | `agent.spawn`, `turn.step`, `tool.call`, `turn.complete` |
| **loops** | model loops that match no card: workflow agents, compactions, memory forks | `turn.step` ids no card claims |
| **receipt** | the running turn, or the last one: duration, agents, edits, errors, cost added | `turn.start`, `turn.complete` |
| **log** | prompts, spawns, completions, consults, edits, errors and denials; filtered to one agent while you view its transcript | all of the above |
| **crew** | the 5 agents that fit the current request, picked from every agent the session offers, narrowed by topic tags (`5 of 38 · jev · frontend, testing`) once the catalog is tagged. Beside each name Haiku's one-line task for that agent, or `нет задачи` when Haiku gave none; under the name, one dim line (at most 160 characters) with a short draft of how the agent would start, until `run` replaces it with the full prompt; when Haiku fails, the row just has no such line. `run` (a framed button) has Haiku write the agent's prompt, starting from that short draft; the draft stays under the row, in full, with `start` (ask the main model to start it in the background), `edit` (a focused pane with the draft; Enter saves it, Escape leaves it as it was) and `drop`. After a turn the panel switches to the next mode (see below). The header says `· jev` or `· by words` | `agent.offer`, `turn.start`, `jev pick-skill`, `$.model.complete`, `$.prompt.submit`, `$.store`, `$.ui.open`, `prompt.suggest`, `tool.check` |

Connectors animate only while work flows: a turn is running, an agent is running, or a consult is open. Panels with nothing to show take no room, so a session without subagents shows just the main box and the log.

### Crew: from the short draft to the full prompt

Say the request is `fix the flaky parser test` in `/work/parser`. Before `run`, a crew row looks roughly like this: the one-line task beside the name, the short draft dim under it.

```text
typescript-reviewer  Check the types in the parser diff          [ run ]
Starts with tsc on the parser package, then reads the diff
```

Pressing `run` makes one Haiku call. The request carries the short draft, so the full prompt starts from the same steps. The model is asked for:

<!-- draft-request:start (bun scripts/readme-draft.ts --write) -->
```text
User request:
fix the flaky parser test

Working directory: /work/parser

Subagent: typescript-reviewer
What it does: Reviews typescript code

Its one-line task for this request: Check the types in the parser diff

Its first steps, already shown to the user; begin the prompt with them, phrased as instructions to the subagent: Starts with tsc on the parser package, then reads the diff

Write the prompt to give this subagent.
```
<!-- draft-request:end -->

The dim line is then replaced by the draft Haiku writes. Its exact words vary from call to call, but the draft opens with those steps as instructions to the agent, for example:

```text
Run tsc on the parser package in /work/parser and note every type error. Then read the
diff of the parser changes and check which of those errors it introduced or hides.
Report each problem with the file and line, and say which one most likely makes the
parser test flaky.
```

A row whose task came without a short draft sends the same request without the `Its first steps` line; if the tasks call failed, the row has no task either, and the `Its one-line task` line is left out too.

### Crew: now and next

The crew panel works in two modes, and switches between them by itself.

- **now**: you sent a prompt, the crew is picked for it, and `run` starts an agent beside the work already going. This is the panel as it always was.
- **next**: the turn ended and Claude Code put its guess at your next prompt dim in the prompt box. The crew is picked for that guess, and a line under the header shows it: `next · <the guess>`. Each row has one button, `next`. It puts the agent in the queue and the row says `queued`; press it again to take the agent off.

When you send your next prompt, Haiku writes each queued agent's task from that prompt (the guess only chose the agents), the agents start in the background and show up as agent cards, and the panel goes back to now for the new prompt. Sending the guess word for word works the same. A guess never replaces a draft you have open or a queue you already made. A queued agent that fails to start leaves a red line in the log. Without prompt suggestions (turned off in Claude Code's settings) there is no guess, so there is no next list.

## Use

| Command | Does |
| --- | --- |
| `/flightdeck` | open the pane |
| `/flightdeck close` | close it |
| `/flightdeck reset` | clear agents, checks, consults, log and the turn (cost, rate limits and compactions stay) |
| `/flightdeck layout auto\|compact\|wide\|mini` | override the layout for this session |

Focus the pane with `ctrl+x tab`, then:

| Key | Does |
| --- | --- |
| `1`, `2`, … | expand an agent card or lane: its full task, last 3 tool calls, start of its answer |
| `f` `s` `o` | open the gate's file / shell / other drill-down: the last 5 checks and their verdicts |

`/clear` resets the pane along with the conversation.

## Where it runs

- **Fullscreen terminal:** docked beside the transcript; two columns from 110 columns wide.
- **Main-screen terminal:** inline above the prompt, as the 8-row summary.
- **Desktop app, VS Code, mobile:** the same panels, plus the agents drawn as an SVG time axis. VS Code and mobile can't animate, so connectors and clocks are static there.

With `openOnStart`, the pane opens by itself when a session starts, in terminals at least 144 columns wide; below that, `/flightdeck` opens it. Colours come from your Claude Code theme, so light, dark and colour-blind themes all read.

## What it can reach

Flightdeck only watches, except for the crew panel's buttons. Every hook passes its event on unchanged: it never denies, rewrites or delays a tool call, a prompt or a subagent. The one exception is the permission check of an agent the crew panel itself starts (see below).

| It sees | Through |
| --- | --- |
| every tool call's name and input, and whether it failed | `tool.call` |
| every permission verdict | `tool.check` |
| subagent spawns, their model requests and token usage, and their final answers | `agent.spawn`, `turn.step`, `turn.complete` |
| your prompts' first 70 characters, for the log | `turn.start` |
| context, cost and rate-limit readings | `session.measure`, `$.session.usage()` |
| advisor tool calls in the assistant's responses (their content is encrypted) | `session.append` |

What it keeps: short summaries (a tool name plus a path or command, with credentials masked) in session state, which ends with the session. It makes no network requests of its own and stores only the crew panel's helpers across sessions (see below).

The **crew** panel is the exception, and only it:

- on each of your prompts it writes the agent catalog (names and descriptions) as `$TMPDIR/flightdeck-crew/<agent>/SKILL.md` and runs `jev pick-skill` on it, which sends your prompt to Jev; when `jev` is missing or fails, the panel falls back to word match;
- after each turn, Claude Code's guess at your next prompt (`prompt.suggest`) goes through the same jev and Haiku steps, to pick the next crew;
- every prompt also sends the query, the working directory and the 5 agents' descriptions to Haiku in one call, for the one-line tasks beside the names and the short drafts under them;
- once per catalog, Haiku also gets the agent names and descriptions (about 50 per call) to tag them by topic; the tags narrow the list, and jev picks the tags of your prompt;
- `run` calls Haiku with your prompt, the working directory, the agent's description and its one-line task;
- `$.store` keeps, across sessions, the tag map, a cache of the last 50 jev answers and of the one-line tasks (a repeated prompt asks neither jev nor Haiku again), and the last 10 edits per agent;
- `start` (or `run` with `crewRun: direct`, or a queued agent when you send the next prompt) asks the main model to start that agent in the background through one request sent with `$.prompt.submit` (several queued agents share one request), the task text verbatim. The row reads `started` when the request is submitted. There is no stop button: once the model starts the agent, it runs to the end;
- flightdeck does not call Agent itself: in auto mode the engine skips a plugin's own hooks on `$.agent.spawn`, and the classifier refuses a spawn that no request asked for. The request to the main model is what the classifier sees;

Drop `crew` from `panels` to turn all of this off. `claude plugin validate .` prints exactly what it hooks and calls.

## What is inferred, not measured

- **Architect moments.** "Before a plan" means no edits yet this turn, "error repeats" means 2+ main-loop errors in a row, "before done" means edits were made. They are labelled `(inferred)`; turn them off with `moments: false`.
- **Server-side advice is encrypted.** For a server tool such as Claude Code's `advisor`, the pane counts and times the consult but cannot show what it said.
- **Per-agent context is the latest request's whole input** (uncached + cache read + cache write). It is labelled `ctx`, not cost: the API has no per-agent cost.
- **Other loops** can't tell a workflow agent from a compaction fork; both are model loops no card claims.
- **A background agent's first step** can arrive before its card exists, so its usage may show one step late.

## Configure

In `/config`, or under `pluginConfigs["flightdeck"].options` in `settings.json`:

| Option | Default | Meaning |
| --- | --- | --- |
| `architectPattern` | `advisor\|architect` | case-insensitive regex for agent types and server tools that count as the architect |
| `matchDescriptions` | `false` | also match agent descriptions, not just type names |
| `architectLabel` | `ARCHITECT` | the architect's name in the pane |
| `gateLabel` | `GATE` | the permission panel's name |
| `panels` | `main,architect,gate,agents,loops,receipt,log,crew` | which panels show, in order |
| `crewRun` | `draft` | `draft` shows Haiku's prompt before spawning; `direct` sends the request as soon as the prompt is written |
| `layout` | `auto` | `mini`, `compact`, `wide`, or `auto` (mini inline, wide from 110 columns docked) |
| `maxCards` | `3` | cards side by side before swimlanes (1–6); fewer if the pane is too narrow |
| `motion` | `while-active` | `off` keeps connectors still |
| `moments` | `true` | show the inferred consult moments |
| `palette` | `theme` | `pastel` uses fixed colours tuned for dark terminals |
| `openOnStart` | `true` | ask to open the pane when a session starts |
| `statusLine` | `true` | context, running agents, consults and denials in the status line |

## Troubleshooting

**The pane doesn't appear.**
- Check `claude --version` is 2.1.287 or later, then run `/reload-plugins` and `/flightdeck`.
- Below 144 columns, Claude Code won't seat a pane nobody asked for; `/flightdeck` opens it at any width.
- Look in the transcript for a dim line starting `flightdeck:`. It names the hook that failed or the reason the pane was refused. Please [open an issue](https://github.com/scasella/claude-flightdeck/issues) with it.

**No next list after a turn.** It needs Claude Code's prompt suggestions: the dim guess in the empty prompt box. When they are off, the crew panel stays in the now mode.

**Colours look wrong.** Set `palette` to `pastel` in `/config`.

**It's too much motion.** Set `motion` to `off`.

**Counters look stale after an update.** Run `/flightdeck reset`.

## How it works

| File | Holds |
| --- | --- |
| [`hooks/register.tsx`](hooks/register.tsx) | the event hooks, state access, and one function per panel |
| [`hooks/core.ts`](hooks/core.ts) | every reducer, formatter and layout rule as pure functions, so behaviour is testable directly |
| [`hooks/rail.tsx`](hooks/rail.tsx), [`hooks/elapsed.tsx`](hooks/elapsed.tsx) | surface modules: animated connectors and live clocks that redraw only themselves, on the surface's own frame clock |
| [`types/index.d.ts`](types/index.d.ts) | the state contract |
| [`tests/`](tests) | 24 tests: pure behaviour, plus drawings mounted on every surface at 40–120 columns |

State lives in `$.state` atoms. Every read is merged over defaults, so a missing or older field never breaks the pane; an update that changes the state's shape may still reset its counters once. New to mods? Start with [Claude Code mods](https://claude.com/blog/claude-code-mods) and [Getting started with Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/).

## Related projects

Flightdeck works alongside these, and owes ideas to them:

- [claude-hud](https://github.com/jarrodwatts/claude-hud): context, limits, tools and agents in your status line. Use both: that's the status line, this is the pane.
- [zoetrope](https://github.com/furkankly/zoetrope): a Claude Code or Codex session as a live flow graph.
- [ccusage](https://github.com/ccusage/ccusage): cost reports from your session logs.
- [awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods): the index of Claude Code mods.

## Develop

```sh
claude --plugin-dir .            # load it; edits hot-reload
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .       # after the first load, which writes .claude-plugin/types/
bun scripts/readme-draft.ts      # README's draftRequest example matches hooks/crew.ts; --write refreshes it
```

The last check reads files, so it can't live in `claude plugin test` (its sandbox has no file access). In this repo the pre-commit hook (`.beads/hooks/pre-commit`) runs it whenever `hooks/crew.ts` or `README.md` is staged.

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
