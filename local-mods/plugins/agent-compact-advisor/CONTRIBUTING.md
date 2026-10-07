# Contributing

## Setup

```sh
npm ci            # installs tooling and the git hooks (lefthook)
npm run check     # format, typecheck, lint, repo lint, validate, tests
```

agent-compact-advisor needs Claude Code 2.1.287+ (mods are on by default). Try it live with
`claude --plugin-dir .` from the repository root.

## Rules of the house

- TypeScript at its strictest (`tsconfig.json`), ESLint with no warnings and no
  unexplained suppressions (a second pass with inline config off refuses them).
- No mutation, no `let`, no loops, no classes. `hooks/model/` is pure and
  held to `eslint-plugin-functional`'s strict preset.
- Files ≤ 250 lines, functions ≤ 40, complexity ≤ 12.
- Every behaviour has a test under `tests/`, named for the file it covers, run by
  `claude plugin test`. No network in tests (Kev is mocked through `http.fetch`).
- [Conventional Commits](https://www.conventionalcommits.org) with a scope:
  `agent-compact-advisor`, `repo`, `deps`, `ci`, `main`. Releases are cut by release-please.
- After a Claude Code update: `npm run update-types`, then `npm run check`.

`npm run lint` lints the pure model in its own ESLint process: eslint-plugin-functional
caches type immutability per type, not per rule level, so linting `hooks/` (lite) and
`hooks/model/` (strict) in one process would make the result depend on file order.

## Live checks

`npm run eval` runs `claude plugin eval` over `evals/`: each case is a real
headless (`claude -p`) session with only this plugin loaded, and the case sends
one of the mod's own commands. It covers what the unit tests cannot: that the
hooks module loads in the engine and registers its command, and that the
command's answer comes back. The cases need no model turns (about $0, a few
seconds).

It runs on your own Claude login, locally; CI does not run it.

It cannot see the status line (a headless session draws none).
`npm run smoke:live` does: it starts a real interactive session in tmux, sends
one small turn, captures the screen and checks that the status line carries the
advisor's verdict (`too early: context is small`). It needs tmux and a Claude
login, takes about 10 s for a cent, and is local only (no tmux session with a
login in CI).

## Dependency holds

- `typescript` stays on 6.x (6.0.3): `typescript-eslint` 8.71.0, its latest,
  declares the peer `typescript >=4.8.4 <6.1.0`. Take TypeScript 7 once it widens
  that range; drop the Dependabot `ignore` for `typescript` then.
