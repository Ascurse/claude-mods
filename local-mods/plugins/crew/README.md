# Crew

A Claude Code mod that suggests which of the session's agents fit your request, has Haiku draft the task prompt, and starts the agent in the background. It was the CREW panel of [flightdeck](../flightdeck/README.md) and now has its own pane.

The pane looks one step ahead. When Claude finishes answering in the main session (not a subagent, not an aborted turn), Haiku predicts the next step from your last prompt, the end of Claude's reply, the files edited since that prompt, `git status --short`, `git diff --stat`, the first 3 tasks of `bd ready` and Claude Code's grey guess at your next prompt, and Crew shows the 5 agents that fit that step, picked from every agent the session offers and narrowed by topic tags once the catalog is tagged. Agents already started in the session are left out, and Haiku is told not to suggest work that is already done. When Haiku gives no step, the crew is picked for your last prompt, so a list is always there. The pane opens with the first prediction (option `autoOpen`), not at session start. The header reads `CREW · next: <step>` with `↻` on the right. Beside each name, in the accent colour, is Haiku's one-line task for that agent, dim, or `нет задачи`; under the row, one dim line (at most 160 characters) with a short draft of how the agent would start. `▸ run` on the right has Haiku write the agent's prompt; the draft then stays under the row with `▸ start` (ask the main model to start it in the background), `✎ edit` (a focused pane; Enter saves, Escape leaves it as it was) and `✕ drop`. The main action is the bright one, the others are dim. While Haiku writes, the row says `writing`; once started, `started`. `↻` predicts again for where the conversation is now, skipping the cache. Rows with a draft or `writing` stay on top through any refresh, `started` ones only through `↻`; the new picks fill the free places, 5 rows at most. While Crew loads, the header reads `CREW · next: …`, `↻` is dim and does nothing, and the rows are placeholders. An empty pane draws nothing, unless you opened it with `/crew`: then it shows the header with `↻`.

## Use

| Command | Does |
| --- | --- |
| `/crew` | open the pane |
| `/crew refresh` | same as `↻`: predict the next step again and pick the crew for it |
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

## What it can reach

Crew never denies, rewrites or delays a tool call, a prompt or a subagent. It reads the agent catalog (`agent.offer`), your prompts (`turn.start`), the end of each main-session turn (`turn.complete`), Claude Code's guess at your next prompt (`prompt.suggest`) and the conversation (`$.session.messages()`) for your last prompt, the end of the last reply, the files edited since that prompt and the agents already started. It runs `git status --short`, `git diff --stat` and `bd ready --json --brief --limit 3` in the working directory; a command that is missing or fails is left out. It makes no network requests of its own; the model calls below go through `jev` and `$.model.complete`.

- after each answer it sends that context (the reply cut to its last 400 characters) to Haiku for the next step;
- for that step it writes the agent catalog (names and descriptions) as `$TMPDIR/crew/agents/<agent>/SKILL.md` (topic tags go to `$TMPDIR/crew/tags`, beside it, so Jev never picks a tag for an agent) and runs `jev pick-skill` on it, which sends the step to Jev; when `jev` is missing or fails, the pane falls back to word match;
- when Claude Code's guess at your next prompt arrives after the answer, the step is predicted once more with it, unless a draft, an edit or a `writing` row is open;
- `↻` and `/crew refresh` predict the step again and pick for it without reading the cache;
- every step also sends the step, the working directory and the 5 agents' descriptions to Haiku in one call, for the one-line tasks beside the names and the short drafts under them;
- once per catalog, Haiku also gets the agent names and descriptions (about 50 per call) to tag them by topic; the tags narrow the list, and jev picks the tags of the step;
- `run` calls Haiku with the step, the working directory, the agent's description and its one-line task;
- `$.store` keeps, across sessions, the tag map, a cache of the last 50 jev answers and of the one-line tasks, and the last 10 edits per agent;
- `start` (or `run` with `crewRun: direct`) asks the main model to start that agent in the background through one request sent with `$.prompt.submit`, the task text verbatim. The row reads `started` when the request is submitted. There is no stop button: once the model starts the agent, it runs to the end;
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
