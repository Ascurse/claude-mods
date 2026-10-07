<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.svg">
  <img alt="agent-compact-advisor: tells you when your Claude Code session is ready to /compact" src=".github/assets/banner-light.svg" width="100%">
</picture>

![Claude Code session: a small turn reads "too early: context is small (35k)"; after a turn that reads four log files the status line alerts "context 63% — time to compact" although the score is only 66 of 100, the ready /compact appears in the prompt box, Tab takes it, and after the compaction the line resets to "context is small"](demo/demo.gif)

[![ci](https://github.com/apolenkov/agent-compact-advisor/actions/workflows/ci.yml/badge.svg)](https://github.com/apolenkov/agent-compact-advisor/actions/workflows/ci.yml)
[![codeql](https://github.com/apolenkov/agent-compact-advisor/actions/workflows/codeql.yml/badge.svg)](https://github.com/apolenkov/agent-compact-advisor/actions/workflows/codeql.yml)
[![release](https://img.shields.io/github/v/release/apolenkov/agent-compact-advisor?sort=semver)](https://github.com/apolenkov/agent-compact-advisor/releases)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Claude Code ≥ 2.1.287](https://img.shields.io/badge/Claude%20Code-%E2%89%A5%202.1.287-8F5400)](https://claude.com/claude-code)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/apolenkov/agent-compact-advisor/badge)](https://scorecard.dev/viewer/?uri=github.com/apolenkov/agent-compact-advisor)

A Claude Code mod that tells you how good a moment it is to `/compact` now,
and why, and makes compaction safer. It never compacts by itself.

```
agent-compact-advisor: хороший момент для /compact: оценка 98 из 100 · контекст 400k (40%) · хвостов нет · цель достигнута с вероятностью 90% · кэш тёплый
agent-compact-advisor: можно подождать: оценка 50 из 100 · контекст 400k (40%) · хвосты неизвестны · кэш остыл
agent-compact-advisor: рано: идёт фоновая задача · контекст 243k (24%)
agent-compact-advisor: рано: работает 2 агента · контекст 400k (40%)
agent-compact-advisor: контекст 61% — пора компактить · рано: хвосты — ждать итоги · контекст 610k (61%)
```

## Why

- Compact too early and you throw away context you still need; too late and
  the window fills mid-task.
- Compacting while agents or background calls still run loses track of
  them.
- A compaction summary can drop the goal, decisions and open leftovers
  unless asked to keep them.

## Features

- 📊 **Status line** after every main turn, and every 30 s: a score 0–100
  and its signals.
- 🚨 **Size alert** from `alertPercent` (60) of the window, whatever the score,
  the gates or the leftovers: the line opens with "контекст 61% — пора
  компактить", one toast per crossing (it re-arms when the share drops, e.g.
  after a compaction), the `/compact` suggested at each turn end (not while
  agents or background calls run).
- 💡 **Suggestion** past the threshold (70): a ready one-line `/compact …` in
  the empty prompt box, Tab takes it; one toast when the score first crosses.
- 🛡️ **Guard**: every `/compact` and auto-compaction of the main
  conversation gets a preservation template added after your own text (goal,
  decisions, open leftovers verbatim, absolute file paths, verification
  results, what not to do). It never cancels a compaction.
- 🔍 **`/compact-advisor`** explains the current score part by part.

## Install

Claude Code 2.1.287+ (mods are on by default).

```
/plugin marketplace add apolenkov/agent-compact-advisor
/plugin install agent-compact-advisor@agent-compact-advisor
```

It is also listed, with its sibling mods, in the
[agent-mods](https://github.com/apolenkov/agent-mods) marketplace:

```
/plugin marketplace add apolenkov/agent-mods
/plugin install agent-compact-advisor@agent-mods
```

Or try a checkout: `claude --plugin-dir /path/to/agent-compact-advisor`.

## Usage

| Command / key      | What it does                                           |
| ------------------ | ------------------------------------------------------ |
| `/compact-advisor` | Explains the current score part by part                |
| Tab                | Takes the suggested `/compact …` from the empty prompt |

### The score

A score, not a probability: nothing is calibrated.

Gates set it to 0: no context reading yet, context under `minTokens` (100k),
running agents, live background calls, or leftovers listed in the last answer
(unless `ignoreLeftovers`).
Otherwise it is a weighted sum:

| Part      | Weight | Value                                                                            |
| --------- | ------ | -------------------------------------------------------------------------------- |
| fill      | 40     | from `minTokens` to `min(fullTokens, 90% of the window)`                         |
| leftovers | 30     | 1 when the last answer's leftover lines all say none                             |
| P1        | 20     | Kev's done-signal; 0 while asked; weight removed when Kev is off or down         |
| cache     | 10     | 1 within `cacheTtlMin` of the last turn (the compaction reads the cached prefix) |

It is capped at 60 while background work is unknown (agent-shell-watch not
loaded) or the last answer has no leftover lines, so a suggestion needs both
known. With `ignoreLeftovers` the leftovers part leaves the sum (the rest is
rescaled, as for an absent P1) and never gates or caps: for a coordinator
session, whose leftovers always say "wait for the others".

**Leftovers** are read from lines starting with `Хвосты для агента:` and
`Хвосты для владельца:` (the last of each counts; list marks, quotes, bold and
code are tolerated). Both prefixes and the words meaning none (`нет`, `none`)
are settings: for an English convention set `leftoverPrefixes` to `Leftovers:`.

**Words.** The status line, toasts and `/compact-advisor` use plain words, no
abbreviations, in `language`: `ru` (default, like the Russian leftover
prefixes) or `en`. A gate reads "рано: …" / "too early: …", a score at or
above `threshold` "хороший момент для /compact: оценка 82 из 100 · …", below
it "можно подождать: …".

**P1** asks Kev (System One, `kev-latest`) one question over the last answer's
final 8000 characters, on loopback only, with a 20 s timeout.

**Background calls** come from
[agent-shell-watch](https://github.com/apolenkov/agent-shell-watch)'s call list.

## Configuration

Set in `/config`.

<details>
<summary><b>All settings</b></summary>

| Setting            | Default                                     |                                                                    |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------ |
| `threshold`        | 70                                          | score from which the `/compact` is suggested                       |
| `minTokens`        | 100000                                      | below it the score is 0                                            |
| `fullTokens`       | 300000                                      | context at which the fill part is complete                         |
| `cacheTtlMin`      | 5                                           | minutes the prompt cache counts as warm (60 with the 1-hour cache) |
| `systemOneUrl`     | `http://127.0.0.1:8010`                     | Kev for P1; loopback only, empty turns it off                      |
| `kevModel`         | `kev-latest`                                | System One model                                                   |
| `leftoverPrefixes` | `Хвосты для агента:\|Хвосты для владельца:` | `\|`-separated                                                     |
| `noneWords`        | `нет\|none`                                 | `\|`-separated                                                     |
| `guardCompactions` | true                                        | add the template to every compaction                               |
| `statusLine`       | true                                        | show the score                                                     |
| `ignoreLeftovers`  | false                                       | leftovers neither gate, cap nor count (coordinator sessions)       |
| `language`         | `ru`                                        | words of the status line, toasts and explanation: `ru` or `en`     |
| `alertPercent`     | 60                                          | context share (%) that alerts regardless of score; 0 turns it off  |

</details>

## Privacy

One network call, on loopback only: P1 posts the last answer's final 8000
characters to `systemOneUrl`. No key, no telemetry, nothing stored across
sessions. See [SECURITY.md](SECURITY.md) for what it reads and sends.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) to work on it: `npm ci`, then
`npm run check`. Questions: [SUPPORT.md](SUPPORT.md).

Live checks run locally: `npm run eval` (headless, on your Claude login; not in CI).

## License

[MIT](LICENSE). `engine-types/claude-code.d.ts` is © Anthropic PBC and not
covered by the MIT license; see [engine-types/NOTICE.md](engine-types/NOTICE.md).
