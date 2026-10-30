---
name: skill-stocktake
description: "Use when auditing Claude skills and commands for quality. Supports Quick Scan (changed skills only) and Full Stocktake modes with sequential subagent batch evaluation."
metadata:
  origin: ECC
disable-model-invocation: true
---

# skill-stocktake

Slash command (`/skill-stocktake`) that audits all Claude skills and commands using a quality checklist + AI holistic judgment. Supports two modes: Quick Scan for recently changed skills, and Full Stocktake for a complete review.

## Scope

The command targets the following paths **relative to the directory where it is invoked**:

| Path | Description |
|------|-------------|
| `~/.claude/skills/` | Global skills (all projects) |
| `{cwd}/.claude/skills/` | Project-level skills (if the directory exists) |

**At the start of Phase 1, the command explicitly lists which paths were found and scanned.**

### Targeting a specific project

To include project-level skills, run from that project's root directory:

```bash
cd ~/path/to/my-project
/skill-stocktake
```

If the project has no `.claude/skills/` directory, only global skills and commands are evaluated.

## Modes

| Mode | Trigger | Duration |
|------|---------|---------|
| Quick Scan | `results.json` exists (default) | 5–10 min |
| Full Stocktake | `results.json` absent, or `/skill-stocktake full` | 20–30 min |

**Results cache:** `~/.claude/skills/skill-stocktake/results.json`

## Quick Scan Flow

Re-evaluate only skills that have changed since the last run (5–10 min).

1. Read `~/.claude/skills/skill-stocktake/results.json`
2. Run: `bash ~/.claude/skills/skill-stocktake/scripts/quick-diff.sh \
         ~/.claude/skills/skill-stocktake/results.json`
   (Project dir is auto-detected from `$PWD/.claude/skills`; pass it explicitly only if needed)
3. If output is `[]`: report "No changes since last run." and stop
4. Прогнать `bash ~/.claude/skills/skill-stocktake/scripts/lint.sh <изменённые SKILL.md>`
   (Phase 0 по списку изменений) — `FAIL` чинить до оценки
5. Re-evaluate only those changed files using the same Phase 2 criteria
6. Carry forward unchanged skills from previous results
7. Output only the diff
8. Run: `bash ~/.claude/skills/skill-stocktake/scripts/save-results.sh \
         ~/.claude/skills/skill-stocktake/results.json <<< "$EVAL_RESULTS"`

## Full Stocktake Flow

### Phase 0 — Mechanical lint (обязательно, до субагентов)

Run: `bash ~/.claude/skills/skill-stocktake/scripts/lint.sh`

Детерминированная проверка: описание есть, короче 1024 знаков, не пересказывает
порядок шагов, не прячет в себе подсказку модели; `WARN` — SKILL.md крупнее
`skills.lint_warn_lines` из `~/.claude/thresholds.yaml` (перекрывается переменной
окружения `SKILL_LINT_WARN_LINES`). Работает мгновенно и бесплатно —
поэтому идёт **перед** Phase 2: то, что ловится здесь, не должно попадать в разбор
субагентами.

- **FAIL** — исправить до запуска Phase 2, эти же навыки не оценивать «по содержанию»,
  пока описание сломано: субагент судит навык по описанию.
- **WARN** — не блокирует, но передать список в Phase 2 как повод проверить,
  не пора ли выносить часть в `references/`.

Тот же скрипт принимает пути: `bash .../lint.sh path/to/SKILL.md` — для Quick Scan
прогнать его только по изменённым файлам из `quick-diff.sh`.

Затем: `python3 ~/.claude/skills/skill-stocktake/scripts/corpus.py`

`lint.sh` смотрит на каждый навык отдельно, `corpus.py` — на связи между ними, и
ловит то, чего в одном файле не видно:

- **FAIL `name`** — имя во frontmatter разошлось с каталогом.
- **FAIL `link`** — ссылка из SKILL.md ведёт на несуществующий файл.
- **WARN `activation`** — два описания пересекаются выше `skills.activation_overlap`.
  Это главная находка скрипта: модель выбирает навык по описанию, и похожие
  описания означают, что вызовется не тот. Чинится правкой описаний, а не тела.
- **WARN `orphan`** — файл в корне навыка или в `references/` ни разу не упомянут
  в SKILL.md (кандидат в `config-gc`). Сгенерированные подкаталоги не проверяются.
- **WARN `skillref`** — навык ссылается по имени на другой навык, которого нет
  ни в одном из трёх каталогов (`~/.claude/skills`, `~/.agents/skills`,
  `~/.codex/skills`) и ни среди плагинных. Проверка `link` смотрит на файлы,
  эта — на имена; маркетплейсные пакеты приезжают без своих специалист-навыков
  и молча отсылают в пустоту. **Точность неполная**: ловятся только триггерные
  конструкции (`see X`, `skill X`, `Отличие от X`, ячейка таблицы фаз), а среди
  находок остаётся ~40% шума из дефисных прилагательных: `award-winning` и
  `jobs-to-be-done` по форме неразличимы, список читает человек, а не скрипт.
- **WARN `startup`** — имена и описания всех навыков превысили
  `skills.startup_budget_tokens`; это плата за корпус в каждой сессии.

`activation` и `startup` считают только навыки, видимые модели. Навык с
`disable-model-invocation: true` вызывается лишь руками: его описание не
попадает в стартовый список, ни за какой вызов не конкурирует и в бюджет старта
не входит. То же делает `skillOverrides` в `settings.json` — навык с
`user-invocable-only` снят с автовызова, даже если своего флага не имеет. Итоговая строка печатает оба числа — сколько проверено и сколько из
них видно модели.

Пороги — в `~/.claude/thresholds.yaml`, секция `skills`. `--json` даёт машинный
вывод, `--selfcheck` проверяет сам скрипт. Прогоняется по всему корпусу целиком —
для Quick Scan он тоже уместен, коллизия появляется от правки одного описания.

### Phase 1 — Inventory

Run: `bash ~/.claude/skills/skill-stocktake/scripts/scan.sh`

The script enumerates skill files, extracts frontmatter, and collects UTC mtimes.
Project dir is auto-detected from `$PWD/.claude/skills`; pass it explicitly only if needed.
Present the scan summary and inventory table from the script output:

```
Scanning:
  ✓ ~/.claude/skills/         (17 files)
  ✗ {cwd}/.claude/skills/    (not found — global skills only)
```

| Skill | Last modified | Description |
|-------|---------------|-------------|

**Two usage sources, and they are not interchangeable.**

1. `invocations` / `last_used` — cumulative call counter the harness keeps itself in
   `~/.claude.json` under `skillUsage` (override with `$SKILL_STOCKTAKE_USAGE_FILE`).
   Always present on a used installation, needs no hooks. This is the source to trust.
2. `use_7d` / `use_30d` — windowed read-counts from `$SKILL_STOCKTAKE_OBSERVATIONS`
   (default `~/.local/share/ecc-homunculus/observations.jsonl`), written by
   `continuous-learning-v2`'s hook. На этой машине хук снесён 14.09.2026 — файла не будет,
   источник 2 не проверять, сразу считать «не измерено».

Check both before Phase 1:

- **`skillUsage` present** → add an `invocations` / `last_used` column, keep the usage line
  in the Phase 2 checklist
- **windowed file missing or empty** → say so plainly; do NOT present `use_7d`/`use_30d`
  zeros, they read as "unused" when they mean "not measured"
- **neither present** → drop the usage line from the checklist entirely

A cumulative zero is still weak evidence on its own: check the file's birth time
(`stat -f %SB`) before treating "never called" as a defect — a skill installed last week
has not had a fair chance. Never let a structural zero produce a Retire verdict.

### Phase 2 — Quality Evaluation

Launch an Agent tool subagent (**general-purpose agent**) with the full inventory and checklist:

```text
Agent(
  subagent_type="general-purpose",
  prompt="
Evaluate the following skill inventory against the checklist.

[INVENTORY]

[CHECKLIST]

Return JSON for each skill:
{ \"verdict\": \"Keep\"|\"Improve\"|\"Update\"|\"Retire\"|\"Merge into [X]\", \"reason\": \"...\" }
"
)
```

The subagent reads each skill, applies the checklist, and returns per-skill JSON:

`{ "verdict": "Keep"|"Improve"|"Update"|"Retire"|"Merge into [X]", "reason": "..." }`

**Chunk guidance:** Process ~20 skills per subagent invocation to keep context manageable. Save intermediate results to `results.json` (`status: "in_progress"`) after each chunk.

After all skills are evaluated: set `status: "completed"`, proceed to Phase 3.

**Resume detection:** If `status: "in_progress"` is found on startup, resume from the first unevaluated skill.

Each skill is evaluated against this checklist:

```
- [ ] Content overlap with other skills checked
- [ ] Overlap with always-loaded context checked (MEMORY.md, CLAUDE.md, .claude/rules/*.md)
- [ ] Every path the skill references actually exists (scripts/, references/, "Related" skill names)
- [ ] Freshness of technical references verified (use WebSearch if tool names / CLI flags / APIs are present)
- [ ] Invocation mode fits: model-invoked pays context load every session — is that reach earned, or should it be user-invoked?
- [ ] Failure modes named where present: sprawl, sediment, duplication, no-op lines, steering by negation, fuzzy completion criteria
- [ ] Usage frequency considered — INCLUDE THIS LINE ONLY IF `skillUsage` has data (see Phase 1),
      and weigh it against the skill's birth time, not just the count
```

The last two items use the vocabulary in `~/.claude/references/skill-quality.md` — pass that
file's path to the evaluating subagent and have it read the file before judging, so verdicts
name a diagnosed failure mode instead of a vague "too long".

Verdict criteria:

| Verdict | Meaning |
|---------|---------|
| Keep | Useful and current |
| Improve | Worth keeping, but specific improvements needed |
| Update | Referenced technology is outdated (verify with WebSearch) |
| Retire | Low quality, stale, or cost-asymmetric |
| Merge into [X] | Substantial overlap with another skill; name the merge target |

Перед оценкой прогнать пять жёстких гейтов из
`~/.claude/references/skill-change-rubric.md` (Часть 1): активация, исполнимость, место
в корпусе, проверяемость утверждений, цена сопровождения. Гейт не взвешивается и не
компенсируется — навык, заваливший G4 (утверждения без опоры) или G5 (волатильные числа
в теле вместо `references/`), получает `Improve` с названным гейтом, а не общий балл.
Путь к файлу передать оценивающему субагенту вместе с `skill-quality.md`.

Evaluation is **holistic AI judgment** — not a numeric rubric. Guiding dimensions:
- **Actionability**: code examples, commands, or steps that let you act immediately
- **Scope fit**: name, trigger, and content are aligned; not too broad or narrow
- **Uniqueness**: value not replaceable by MEMORY.md / CLAUDE.md / another skill
- **Currency**: technical references work in the current environment

**Reason quality requirements** — the `reason` field must be self-contained and decision-enabling:
- Do NOT write "unchanged" alone — always restate the core evidence
- For **Retire**: state (1) what specific defect was found, (2) what covers the same need instead
  - Bad: `"Superseded"`
  - Good: `"disable-model-invocation: true already set; superseded by skill-stocktake Phase 0, which covers the same checks plus usage counts. No unique content remains."`
- For **Merge**: name the target and describe what content to integrate
  - Bad: `"Overlaps with X"`
  - Good: `"42-line thin content; Step 4 of chatlog-to-article already covers the same workflow. Integrate the 'article angle' tip as a note in that skill."`
- For **Improve**: describe the specific change needed (what section, what action, target size if relevant)
  - Bad: `"Too long"`
  - Good: `"276 lines; Section 'Framework Comparison' (L80–140) duplicates ai-era-architecture-principles; delete it to reach ~150 lines."`
- For **Keep** (mtime-only change in Quick Scan): restate the original verdict rationale, do not write "unchanged"
  - Bad: `"Unchanged"`
  - Good: `"mtime updated but content unchanged. Unique Python reference explicitly imported by rules/python/; no overlap found."`

### Phase 3 — Summary Table

| Skill | Lines | Verdict | Confidence | Reason |
|-------|-------|---------|------------|--------|

(Add an `invocations` / `last_used` column only when `skillUsage` has data — see Phase 1.)

Каждый кандидат на Retire/Merge проверяется отдельно, до попадания в таблицу: маска, область
`grep` и угаданное написание (дефис против подчёркивания) — это гипотеза, а не доказательство.
Прямая проверка существования пути плюс прямой поиск ссылок по обоим написаниям в `~/.claude`
**и** в проектных настройках. Не подтвердился — кандидат выбывает, а не переезжает в низкую
уверенность. В колонке `Confidence` — что именно проверено.

### Phase 4 — Consolidation

1. **Retire / Merge**: present detailed justification per file before confirming with user:
   - What specific problem was found (overlap, staleness, broken references, etc.)
   - What alternative covers the same functionality (for Retire: which existing skill/rule; for Merge: the target file and what content to integrate)
   - Impact of removal (any dependent skills, MEMORY.md references, or workflows affected)
2. **Improve**: present specific improvement suggestions with rationale:
   - What to change and why (e.g., "trim 430→200 lines because sections X/Y duplicate python-patterns")
   - User decides whether to act
3. **Update**: present updated content with sources checked
4. Переписал навык и выбираешь между старой и новой редакцией — Часть 2
   `~/.claude/references/skill-change-rubric.md`: сравнение по пяти измерениям и
   тай-брейкеры при ничьей (проще → меньше волатильных утверждений → правка
   существующего, а не новый навык → внятнее gotchas → к человеку). Без этого
   выбор систематически уходит к более длинному варианту: объём читается как глубина.
5. Check MEMORY.md line count; propose compression if >100 lines

## Results File Schema

`~/.claude/skills/skill-stocktake/results.json`:

**`evaluated_at`**: Must be set to the actual UTC time of evaluation completion.
Obtain via Bash: `date -u +%Y-%m-%dT%H:%M:%SZ`. Never use a date-only approximation like `T00:00:00Z`.

```json
{
  "evaluated_at": "2026-02-21T10:00:00Z",
  "mode": "full",
  "batch_progress": {
    "total": 80,
    "evaluated": 80,
    "status": "completed"
  },
  "skills": {
    "skill-name": {
      "path": "~/.claude/skills/skill-name/SKILL.md",
      "verdict": "Keep",
      "reason": "Concrete, actionable, unique value for X workflow",
      "mtime": "2026-01-15T08:30:00Z"
    }
  }
}
```

## Notes

- Evaluation is blind: the same checklist applies to all skills regardless of origin (ECC, self-authored, auto-extracted)
- Archive / delete operations always require explicit user confirmation
- No verdict branching by skill origin
