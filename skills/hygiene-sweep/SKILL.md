---
name: hygiene-sweep
description: "Setup hygiene pass: free scripted sweep of ~/.claude into one ranked report, then manual audits; deletion via config-gc."
metadata:
  origin: local
disable-model-invocation: true
---

# hygiene-sweep

An orchestrator, not a new audit. The script gathers what existing tools already know and adds the
one thing none of them does: MCP usage over time against what each server costs at startup.
The skills stay independent: each can still be invoked on its own.

## Phase 1: the free sweep (scripted, no model)

```bash
python3 ~/.claude/skills/hygiene-sweep/scripts/sweep.py          # add --log to append to context-budget-log.tsv
```

About a minute, stdlib only, no model turns, changes no config. Run it from the project whose
scope you want (project MCP servers depend on cwd). Writes `~/.claude/audits/hygiene-YYYY-MM-DD.{md,json}`.
Exit code 1 means at least one source failed: the report still exists, and its "Упавшие источники"
section names what is missing, so read it before trusting a zero. Selftest: `sweep.py --selftest`.

| Source | Gives |
|---|---|
| `claude -p /context` | cost by category, schema size by server |
| `claude -p /skill-doctor` | skills never invoked, idle plugins |
| `claude mcp list` | connection status |
| `claude plugin list --json`, `plugin details` | always-on cost and components |
| transcripts `~/.claude/projects/**/*.jsonl` | MCP, skill, command and agent calls over 30 and 90 days |
| first attachments of the latest session | deferred-name list, server instructions, hook insertions, failed servers |
| `settings.json`, `gc_log.md`, plugin cache | orphan hook paths, allow rules, stale versions, trash size, next review |
| hook scripts, global rule files, own `SKILL.md` files | links to skills the agent cannot reach, demands to invoke a user-only skill, broken skill symlinks, overrides without a skill |
| `skill-stocktake/scripts/{lint.sh,corpus.py}`, `instructions-drift.py`, `vault-audit` if present | their one-line verdicts |
| `ccusage` | last 7 days of spend |

Runs monthly as scheduled task `hygiene-sweep-monthly`, and by hand whenever something looks off: the script does not need this skill to be invoked.

Numbers live in `~/.claude/thresholds.yaml`, section `hygiene:`.

Decisions live in `~/.claude/audits/hygiene-keep.tsv`: a keep record silences a candidate until its
`review_after` date, so the same question is not asked every month.

## Reading the report

- **Zero calls is evidence, not a verdict.** Transcripts cover Claude Code on this machine only.
  A connector used on claude.ai or in Cowork looks dead here. Disabling it for Claude Code keeps it there.
- **Passive plugins are not candidates.** Hooks, LSP and interface mods work without being called;
  `/skill-doctor` lists them as idle anyway.
- **Deferred schemas are not startup cost.** Under tool search a server pays for its tool names
  and instructions. `saving` counts only that.
- **Before cutting anything,** find out what error it prevents (CLAUDE.md, "Cost / model discipline").

## Phase 2: by hand, only when phase 1 asks for it

These hold confirmation gates or are `user-invocable-only` in `skillOverrides`, so a subagent cannot
run them. `grep disable-model-invocation` does not show that: check `skillOverrides` in `settings.json`.

| Command | When |
|---|---|
| `/config-gc` | any accepted candidate: one at a time, confirmed, soft-deleted, logged |
| `/context-budget-audit` | a category grew in "Дельта", or real API spend looks wrong |
| `/skill-stocktake` | `skill_corpus` errors, or a quality pass over skill bodies |
| `/setup-audit` | more than `setup_audit_every_days` since the date in the report: security, permissions, repeated mistakes |
| `/doctor` | interactive fixes from Claude Code itself: installation, duplicate local CLAUDE.md, slow hooks |
| `/workspace-surface-audit`, `/security-scan` | on demand |
| `rules-distill` | two or more findings about one principle drifting across skills |

## Merging

1. **Dedup by path.** `context-budget-audit` and `config-gc` routinely catch the same bloated file.
2. **A match counts only if the angles differ.** The same brief to two agents is one source speaking twice.
3. **Rank by cost per session:** what loads every time beats a one-off.
4. **Rejected findings are listed** with a one-line reason, or moved to the keep list with a date.

## Boundaries

Applies nothing. `~/.claude/settings.json` changes are shown as a diff for the user to apply.
Does not run: `skill-comply` (runs agents, expensive), `cost-utility-baseline` (monthly, its own cadence),
`wayfinder`, `bd-priorities`.
