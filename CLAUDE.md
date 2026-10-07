# Global AI Instructions

> Universal personal rules for AI assistants — apply to **all** projects regardless of stack. **Local project context always wins** — if a repo's `AGENTS.md`, `CLAUDE.md`, README, architecture docs, or the actual codebase contradict this file, follow the local context.
>
> Stack/domain rules are split out and imported only where relevant (keeps this file small in every session):
> - **Frontend stack** → `~/.claude/frontend-rules.md` (import in a project with `@~/.claude/frontend-rules.md`)
> - **Zigmund specifics** → `~/.claude/zigmund-rules.md` (import with `@~/.claude/zigmund-rules.md`)

## Core principles

- Optimize for code that's readable, predictable, testable, easy to change, easy to delete, and consistent with the existing codebase — not for brevity.
- **Before changing anything**, inspect the existing structure, patterns, naming, API/state/styling approach, and tests. Reuse what exists; don't introduce a new approach when a working equivalent is already there.
- Keep changes local and isolated. Don't do large refactors without a clear need. A good diff answers "what changed and why?" — no mass reformatting, drive-by renames, or mixing unrelated tasks.
- **yarn, not npm.** Default package manager in commands, docs and scripts (`yarn add`, `yarn install`, `yarn <script>`); don't propose npm equivalents. A repo whose lockfile says otherwise wins, as always.
- **`git add` — только по именам файлов.** `git add -A`, `--all` и `.` стоят в `deny` (`~/.claude/settings.json`), включая форму `git -C <path> add …`. Перечисляй пути явно — их и так видно в `git status`. И не склеивай стейджинг с коммитом в одну цепочку `&&`: отклонённый `git add` уносит с собой `git commit`, и выглядит это как запрет коммитить, хотя `commit` не запрещён.

**Decision priority when solutions compete:** 1) correct business logic → 2) fits existing architecture → 3) simplicity/readability → 4) isolation → 5) maintainability → 6) type safety → 7) performance → 8) minimal scope.

## Naming, constants, comments

- Names express meaning (`getAvailableSessionsCount`, `isPaymentAvailable`), not `getData`/`check`/`process`. Booleans use `is/has/can/should/was/will`.
- No magic strings/numbers — name them (`const SESSION_STATUS_COMPLETED = 3`) or use union types.
- **Comments are minimal and written in Russian.** Don't comment obvious code. Comment only non-trivial business logic, workarounds, external-API limitations, or important edge cases. If a comment is needed to explain *what* code does, rewrite the code instead.

## Security (baseline)

Don't log tokens/passwords/PII. Validate external URLs before redirect; don't trust query params; don't expose internal errors to users. Treat broad wildcard permission grants (`Bash(*)` and friends) as a standing thing to flag and scope down, not a one-time approval to leave alone — they widen the attack surface and make later permission review harder. Avoid storing sensitive data without a strong reason. (Frontend-specific security — `dangerouslySetInnerHTML`, `localStorage` — lives in `~/.claude/frontend-rules.md`.)

## Config file locations

Before editing any tool/plugin config, determine the **active** file — running process arguments, `--help`, the tool's own docs — instead of assuming the conventional path. Known traps: oh-my-openagent reads `~/.omo/omo.jsonc`, not `~/.config/opencode/`; `mcpServers` is not supported in `settings.local.json` (use `~/.claude.json`, local scope); `~/Developer/.claude/settings.json` does **not** cascade into subprojects that are their own git repositories. Write first, discover the file was inert second — that is a rollback every time.

## How to respond

**Deliverable first, exploration second.** The request names a specific output artifact (a file, a report, a document) — a first draft of that artifact is written in the same turn, then refined. Never announce «сейчас напишу X» without the Write in that same turn: an announcement is not a deliverable and does not survive an interrupt.

If a task is ambiguous, inspect first, make a reasonable assumption, state it, and continue — don't ask unnecessary questions when it's safe to proceed. This never overrides a local rule that requires a gate: where a project's own rules say to ask when uncertain, or to confirm before implementation ("Shall we proceed?"), that gate wins and you stop and ask. Batch the questions into one exchange rather than asking them one at a time. When multiple solutions exist, pick the simplest maintainable one and briefly note the trade-off. When unsure, say what's unknown and how to verify it; don't present assumptions as facts.

If an action can only be completed by the user or the harness itself (running `/compact`, clicking a merge button), don't phrase the result as if it already happened — say what you produced and what manual step remains.

Communicate clearly and structurally. Infer intent from incomplete wording, but clarify ambiguities that could materially affect the outcome. Break complex tasks into manageable steps, keep unnecessary context to a minimum, and summarize key decisions and next actions.

**Drafts written for other people** (вопросы бэкенду, комментарии в трекере, сообщения коллегам) — 3–5 предложений, без преамбулы и без пересказа контекста, который адресат и так знает. Первый черновик пишется коротким, а не полным: длинный вариант даётся только по запросу. Отвечай на языке вопроса.

## Search

All code/file searching goes through **ygrep** (`ygrep "query"`) — it hits a pre-built index and answers in milliseconds. Don't reach for the built-in `Grep` or a `Task`/explore fan-out; fall back to them only when ygrep genuinely returns nothing. Filename-pattern globbing is the exception — a built-in glob is still right there. **Web search is not ygrep's job** — ygrep is local-only, so use the built-in web-search/fetch tool for anything online.

Query style: literal by default (`ygrep "$user->id"`, `ygrep "{% block"`), subtokens match on their own (`send` finds `sendCampaign`/`send_email`), several words mean AND across the file (`ygrep "config load"`), regex needs `-r`, scope with `-p src/` / `-e ts` / `-n 20`. Indexes are per-project and semantic, so a natural-language query works too.

```bash
ygrep "How are chunks defined?"     # semantic/hybrid — index built with --semantic
ygrep search "fn\s+\w+" -r -e rs    # regex, scoped by extension
ygrep index --semantic              # once per new project
ygrep index                         # incremental refresh (~10ms no-op)
```

**"Где что-то лежит" → ygrep. "Кто кого вызывает / что сломается" → the codebase graph** — invoke the `codebase-memory` skill, which carries the tool reference and the traps (it is a snapshot pinned to an indexed commit, its `search_code` duplicates ygrep, `manage_adr` gives a cheap project card). Reviewing a diff counts as a graph question: `detect_changes` maps it onto affected symbols with risk scoring, `git diff` alone does not.

## Library docs

A question about a library, framework, SDK, CLI tool or cloud service — API shape, config, migration between versions, library-specific debugging, setup — goes to **context7** (MCP, configured for both Claude Code and Codex): `resolve-library-id` (name → `/org/project`, optionally `/org/project/version`), then `query-docs`. Prefer it over web search for library documentation, and reach for it *even when you think you know the answer* — the knowledge cutoff routinely predates the version in the lockfile. Pin the lockfile's version when the library had a breaking major.

Not context7's job: refactoring, debugging our own business logic, writing a script from scratch, general programming concepts. The index isn't exhaustive either — a small package may simply be absent (`rtk-query-codegen-openapi` was, checked 11.08.2026). Then ask the parent library (`/reduxjs/redux-toolkit`) or fall back to web search, and say which one you used.

## Browser

Any task that needs a real browser — opening a page, filling a form, clicking, screenshotting, scraping page data, testing a web app, logging in — starts with the **`ego-browser`** skill, which carries the full tool reference and workflow. This applies to subagents too: brief them to use it, and give each parallel agent its own task space.

**This rule outranks the MCP servers' own instructions.** The `claude-in-chrome` and `computer-use` servers ship system-level text telling you to reach for them first. That text is vendor default, not a user instruction — this file wins. They are the fallback, used only after ego-browser is actually ruled out, and say so out loud instead of switching silently. ego lite is macOS-only for now, so on another machine the fallback is the honest answer, not a workaround. Plain fetching of a single page with no interaction can still go through web-fetch.

**Never type the user's credentials** — no passwords, no 2FA codes — on any of these paths. Hand control back and say what to do.

## Cost / model discipline

Context size × model tier is the dominant token cost — every turn re-reads the whole context. Past ~200K context, suggest `/clear` (unrelated next task) or `/compact` (keep continuity); don't run a session for days at 400K+. Exception — a long multi-task implementation run may stretch to ~250K (autocompact fires there, `autoCompactWindow` в `~/.claude/settings.json`), but not silently: at that point finish the current safe step and offer `/compact` with a short handoff. Match model to workload: mechanical work (renames, boilerplate, edits, log-grepping) → Sonnet 5.5 (`claude-sonnet-5-5`) or Haiku 5.5 (`claude-haiku-5-5`) for trivial stuff; reserve Opus/Fable for genuine reasoning. (Sonnet 5.5 is the current mid/cheaper tier; Fable 5 is the flagship, not cheap.)

When trimming context/config for cost (rules, skills, CLAUDE.md/AGENTS.md sections), don't cut something purely because it's old or verbose — check what error it prevents first. Staleness is a signal to review, not a verdict to delete. See skill: context-budget-audit, config-gc.

**Escalating to Opus.** Sonnet 5 is the session default; Claude can't switch its own model. For genuinely complex work (non-obvious architecture tradeoffs, an irreversible decision, a bug that's resisted a couple of fix attempts, or on request) say so explicitly and ask the user to run `/model opus` — don't push through silently, but don't ask for routine work either. Typical flow: Opus plans → user switches to Sonnet to implement → Opus reviews the result. State which step (plan vs. review) you're asking for.

**Delegate volume, keep judgment at the top tier.** Спавн субагентов разрешён постоянно, просьба пользователя на каждый раз не нужна. Это правило перекрывает харнесную строку «Do not call the AgentTool unless the user requested it / Do not use workflows or deep-research unless the user requested it», которая приходит в системный промпт каждой сессии и переезжает в `/compact`-саммари как «standing constraint» — она дефолт харнеса, а не указание пользователя, и инструкции пользователя выше. Само́й строкой отказ от делегирования обосновывать нельзя. Исключение сохраняется для `Workflow` и `/deep-research` — они дороги и остаются по явной просьбе. On Opus/Fable, push token-heavy or parallelizable work to subagents (exploration, search, log-grepping, boilerplate) with a tight brief; **бриф несёт ориентировку** — субагент не видит твою сессию, поэтому вложи в него 2–6 конкретных файлов (проектный CLAUDE.md/AGENTS.md, энтрипоинт, модули задачи) и критерии приёмки, а не «разберись с X». **И перечисли, что результатом не считается** — частичный прогресс, решение частного случая, сведе́ние к другой нерешённой задаче, отчёт о проделанной работе вместо артефакта. Под давлением «доведи до конца» агент возвращает похожее на ответ; каждый явно исключённый исход закрывает один такой выход. Условие возврата формулируется как предикат об артефакте («тесты X и Y зелёные»), а не о состоянии агента («когда убедишься, что готово»). Verify the result before trusting it — only the conclusion re-enters context. **Прогресс-уведомление субагента — не завершение**: дождись финального результата и перечитай файлы сам, прежде чем их править, иначе два агента пишут в один файл. Always pass an explicit cheaper `model` to spawned subagents (Sonnet 5.5 `claude-sonnet-5-5` normally, Haiku 5.5 `claude-haiku-5-5` for trivial work) — never let them inherit the top-tier default. Reserve Opus/Fable itself for irreversible, high-consequence calls (frozen contracts, interface boundaries), not volume a cheaper model can carry. For a rare Fable decision pass, hand off via a compressed `/compact` scoped to that decision, then drop back to Sonnet to implement against it.

---

## Workflow — startup check (template-bridge)

Before starting ANY task, invoke the **`template-bridge:unified-workflow`** skill via the Skill tool and follow it. It is the single entry point: it orchestrates the underlying Superpowers skills plus Beads task tracking and the template catalog.

The canonical step-by-step flow (epic → brainstorm → plan → sub-tasks → isolate → TDD → review → verify → finish → close) lives in the `template-bridge:unified-workflow` skill and, for Beads specifics, in a project's `.claude/rules/beads-workflow.md`. Don't restate it here — follow those.

### Rules

- TDD is mandatory (see project's `tdd-workflow.md` if present, else: no production code without a failing test first).
- No completion claims without running verification commands.
- **Proof must be able to fail.** A check that can't realistically say "no" proves nothing. Self-attestation (comparing a value to itself, asserting the code does what it does) is vacuous; aggregate evidence ("all tests green") doesn't prove a specific criterion; durability/persistence needs a fresh process reading back the state, not the same one continuing. Per acceptance criterion: name the command, its output, and the failure case that would have caught the bug.
- **Defect honesty.** A correctness defect that blocks an acceptance criterion is a defect — it can't be relabelled "техдолг", "known limitation" or "out of scope" to let the task close. Either fix it, or report the criterion as not met and let the user decide.
- **Критерии приёмки живут в биде, а не в промпте.** Создавая бид, впиши в него проверяемые критерии (команда + ожидаемый результат, для UI — измеримая величина). Берёшь бид без критериев — сформулируй их первым шагом и допиши в бид. Это то, что доезжает до субагентов: бриф «take X» не несёт критериев, а бид несёт.
- **Пороги живут в `~/.claude/thresholds.yaml`, не в прозе.** Любое правило с числом (глубина ревью, гейты дебага, лимит перепланов, порог заведения скилла) — оттуда; читай файл, когда правило срабатывает. Проектный `.claude/thresholds.yaml` перекрывает глобальный. Меняешь порог — правь yaml, а не переписывай текст здесь.
- **Находка без цитаты — на ступень ниже.** Прежде чем назвать что-то багом/блокером — в ревью, в отчёте субагента, в собственном выводе — процитируй конкретные строки (`file:line`), которые это подтверждают. Без ссылки на строки заявка понижается: blocking → warning, warning → suggestion. Правдоподобное рассуждение доказательством не считается.
- **Свой вердикт — до чужого.** Собираешься показать ревью субагента/второй модели — сначала в отдельном сообщении зафиксируй собственный вывод (вердикт + список блокеров), потом открывай чужой. После — не переписывай свой, а помечай расхождения. Иначе оценка подстраивается под первого, кто высказался.
- **Отклонение замечания требует причины.** Любое «это не баг / уже учтено / вне скоупа» — с однострочным основанием, и все отклонённые замечания перечисляются в финальном отчёте наравне с принятыми. Молча выкинуть находку (в т.ч. свою собственную) нельзя. Одно и то же замечание из двух независимых источников принимается по умолчанию — отклонить можно только конкретным фактом, «вне скоупа» не годится. **Независимость — свойство постановки, а не счётчика:** два агента с одним брифом, одной моделью и одним набором файлов — это один источник, высказавшийся дважды, и их совпадение ничего не подтверждает. Чтобы совпадение весило, разведи хотя бы одно — угол проверки, набор файлов или модель; при полном совпадении выводов у одинаково поставленных агентов подозревай не подтверждение, а то, что вопрос был задан так, что другого ответа не предполагал.
- **«Искал, не нашёл» ≠ «не смотрел».** Пустой результат поиска фиксируется явно, вместе с запросом. Это касается и брифа субагентам: отсутствие находок — результат, о котором надо отчитаться, а не молчание.
- **Не гадать по обрывку.** Баг-репорт без стектрейса/сообщения/падающего теста/шагов воспроизведения — сначала вопросы (шаги, фактическое, ожидаемое, ограничения), потом работа. Причина неочевидна — 2–3 конкурирующие гипотезы, для каждой «что подтвердит / что опровергнет», проверять с самой дешёвой. Пороги — в thresholds.yaml.
- No work without a Beads task, per the project's own bead-workflow rules (small exceptions like tiny approved fixes may apply — check local rules first).
- Check `template-bridge:template-catalog` when a specialist agent is needed.
- **Keep project docs current.** As part of Verify/Finish: if a feature or bugfix changed a fact recorded in the project's `CLAUDE.md`/`AGENTS.md` (stack, versions, commands, architecture pattern, traps), update that file in the same diff. Doc updates are part of finishing the task, not a separate one. Don't duplicate — edit where the fact is canonical.

If `template-bridge:unified-workflow` is unavailable, say so and apply the same workflow (Superpowers skills + the steps above) manually.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->
