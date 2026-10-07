# Crew

A Claude Code mod that suggests which of the session's agents fit your request, has Haiku draft the task prompt, and starts the agent in the background. It was the CREW panel of [flightdeck](../flightdeck/README.md) and now has its own pane.

The pane opens with the first suggestion for a prompt (option `autoOpen`), not at session start, and shows the 5 agents that fit the current request, picked from every agent the session offers, narrowed by topic tags (`5 of 38 · jev · frontend, testing`) once the catalog is tagged. Beside each name is Haiku's one-line task for that agent, or `нет задачи` when Haiku gave none; under the name, one dim line (at most 160 characters) with a short draft of how the agent would start, until `run` replaces it with the full prompt. `run` (a framed button) has Haiku write the agent's prompt; the draft stays under the row with `start` (ask the main model to start it in the background), `edit` (a focused pane; Enter saves, Escape leaves it as it was) and `drop`. The header says `· jev` or `· by words`, and ends with `↻`: it picks the crew again for where the conversation is now (your last prompt plus the end of Claude's last reply), skipping the cache. Rows you are working with (a draft, `writing`, `started`, `queued`) stay on top; the new picks fill the free places, 5 rows at most. In the next mode `↻` picks again for the same guess and keeps the queue. While Crew loads, `↻` is dim. An empty pane draws nothing, unless you opened it with `/crew`: then it shows the header with `↻`.

## Use

| Command | Does |
| --- | --- |
| `/crew` | open the pane |
| `/crew refresh` | same as `↻`: pick the crew again for the current conversation |
| `/crew close` | close it |
| `/crew reset` | clear the picked crew and drafts |

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `crewRun` | `draft` | `draft` shows Haiku's prompt before spawning; `direct` sends the request as soon as the prompt is written |
| `palette` | `theme` | `theme` follows your Claude Code theme; `pastel` is fixed colours for dark terminals |
| `autoOpen` | `true` | open the pane when Crew has agents to suggest |

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

The pane works in two modes, and switches between them by itself.

- **now**: you sent a prompt, the crew is picked for it, and `run` starts an agent beside the work already going. 
- **next**: the turn ended and Claude Code put its guess at your next prompt dim in the prompt box. The crew is picked for that guess, and a line under the header shows it: `next · <the guess>`. Each row has one button, `next`. It puts the agent in the queue and the row says `queued`; press it again to take the agent off.

When you send your next prompt, Haiku writes each queued agent's task from that prompt (the guess only chose the agents), the agents start in the background and show up as agent cards, and the panel goes back to now for the new prompt. Sending the guess word for word works the same. A guess never replaces a draft you have open or a queue you already made. A queued agent that fails to start shows a toast. Without prompt suggestions (turned off in Claude Code's settings) there is no guess, so there is no next list.

## What it can reach

Crew never denies, rewrites or delays a tool call, a prompt or a subagent. It reads the agent catalog (`agent.offer`), your prompts (`turn.start`), Claude Code's guess at your next prompt (`prompt.suggest`) and, on `↻` or `/crew refresh` only, the conversation (`$.session.messages()`) for your last prompt and the end of the last reply. It makes no network requests of its own; the model calls below go through `jev` and `$.model.complete`.

- on each of your prompts it writes the agent catalog (names and descriptions) as `$TMPDIR/crew/<agent>/SKILL.md` and runs `jev pick-skill` on it, which sends your prompt to Jev; when `jev` is missing or fails, the pane falls back to word match;
- after each turn, Claude Code's guess at your next prompt goes through the same jev and Haiku steps, to pick the next crew;
- `↻` and `/crew refresh` send your last prompt and the last 400 characters of Claude's reply through the same jev and Haiku steps, without reading the cache;
- every prompt also sends the query, the working directory and the 5 agents' descriptions to Haiku in one call, for the one-line tasks beside the names and the short drafts under them;
- once per catalog, Haiku also gets the agent names and descriptions (about 50 per call) to tag them by topic; the tags narrow the list, and jev picks the tags of your prompt;
- `run` calls Haiku with your prompt, the working directory, the agent's description and its one-line task;
- `$.store` keeps, across sessions, the tag map, a cache of the last 50 jev answers and of the one-line tasks, and the last 10 edits per agent;
- `start` (or `run` with `crewRun: direct`, or a queued agent when you send the next prompt) asks the main model to start that agent in the background through one request sent with `$.prompt.submit`, the task text verbatim. The row reads `started` when the request is submitted. There is no stop button: once the model starts the agent, it runs to the end;
- crew does not call Agent itself: in auto mode the engine skips a plugin's own hooks on `$.agent.spawn`, and the classifier refuses a spawn that no request asked for. The request to the main model is what the classifier sees.

Turn it all off by disabling the mod. `claude plugin validate .` prints exactly what it hooks and calls.

## Develop

```sh
claude --plugin-dir .            # load it; edits hot-reload
claude plugin validate .
claude plugin test .
npx -p typescript tsc -p .       # after the first load, which writes .claude-plugin/types/
bun scripts/readme-draft.ts      # README's draftRequest example matches hooks/crew.ts; --write refreshes it
```

The last check reads files, so it can't live in `claude plugin test` (its sandbox has no file access). In this repo the pre-commit hook (`.beads/hooks/pre-commit`) runs it whenever a file under `hooks/`, `types/`, `scripts/` or `README.md` of this mod is staged.

Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

MIT, original author Stephen Casella (see [LICENSE](LICENSE)).
