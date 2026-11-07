---
name: task-branch
description: "Use when starting a task branch or refreshing a base branch: switch to production or master, pull it, cut a branch for a tracker task. Triggers — \"go to production and update it\", \"перейди на production и актуализируй\", \"сделай ветку под TECH-123\", \"new branch for this task\"."
---

# task-branch — a fresh base, then the task branch

The `production`/`master` model is in `~/.claude/zigmund-rules.md`, section "Branches: production and master". This skill covers the start of a task; `to-test` and `ship` carry it on. Work driven by a bead starts through `beads-workflow`, which owns the `bd-<id>` branch.

## Step 1. Identify the participants

- **Mode.** The request names a task or a branch → the whole flow. The request only says to switch to a base branch and update it → stop after step 3.
- **Base.** The branch the user named ("от ветки X"). Otherwise `production` when it exists on `origin`, whatever `origin/HEAD` says. No `production` on `origin` (for example `chat`) → the branch `origin/HEAD` points at, named in the report.
- **Task.** A tracker ID or URL → read the issue with `tracker_get_issue`.
- **Name.** The name the user gave wins. Otherwise `feature/TECH-123`, or `fix/TECH-123` when the request or the issue type says bug. No ID and no name → ask for the name.

Done when base and name are both known.

## Step 2. Check the working tree

`git status --porcelain` empty → continue. Otherwise ask, and wait for the answer: stash with `git stash push -u` and restore at the end, or commit first. Other people's uncommitted work moves only on that answer.

## Step 3. Refresh the base

```bash
OLD=$(git rev-parse HEAD)
git fetch origin
git switch <base>
git pull --ff-only origin <base>
```

`git pull --ff-only` refuses → the local base has diverged. Show `git log --oneline origin/<base>..<base>` and stop: the base stays as it is until the user decides.

Done when `git rev-parse <base>` equals `git rev-parse origin/<base>`.

## Step 4. Cut the task branch

The name already exists locally or on `origin` → switch to it, say it existed, and report how far it is behind the base (`git rev-list --count <name>..<base>`). Refresh it only if asked.

Otherwise:

```bash
git switch -c <name> <base>
```

Done when `git merge-base <name> origin/<base>` equals `git rev-parse origin/<base>`.

## Step 5. Align dependencies

```bash
git diff --quiet "$OLD" HEAD -- package.json yarn.lock
```

Exit 1 → the install follows the lockfile (`yarn install` for `yarn.lock`), because `tsc`, the bundler and tests lie until `node_modules` matches the line. The repo has no `package.json` → skip.

## Step 6. Report

A tracker task → its title and one line of what it asks. Report the base with its short hash, the branch, and whether stash and install happened. Restore the stash if there is one; conflicts on restore go to the user. Implementation starts on the user's word.
