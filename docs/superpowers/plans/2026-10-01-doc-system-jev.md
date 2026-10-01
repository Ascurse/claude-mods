# doc-system + Jev Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Скрипт `journal-jev.py` с режимами `triage` и `check`: механические сигналы по записям `docs/journal/` плюс совет Jev; замер пользы Jev на живом журнале; встраивание в навык doc-system по итогам замера.

**Architecture:** Один файл на стандартной библиотеке Python в `~/.agents/skills/doc-system/scripts/`. Сначала считаются сигналы из git и файловой системы, затем по записи вызывается `jev ask` (подпроцесс). Скрипт ничего не правит в журналах; при отказе Jev выдаёт только сигналы и выходит с кодом 0. Встроенный `--selftest` строит временный git-репозиторий и подменяет `jev` фальшивым исполняемым файлом.

**Tech Stack:** Python 3.13 (stdlib), git, `jev` CLI (`jev ask`, JSON in/out).

**Spec:** `~/.claude/docs/superpowers/specs/2026-10-01-doc-system-jev-design.md`

## Global Constraints

- Только стандартная библиотека Python; внешние команды — `git` и `jev`.
- Скрипт никогда не пишет в файлы журнала. Архив/удаление — только после «да» пользователя по каждой записи.
- Отказ Jev (нет в `PATH`, ненулевой код, таймаут, непонятный ответ) → вердикт `без Jev`, одна строка причины в stderr, код выхода 0. stderr самого `jev` не печатать.
- Пороги: уверенность ниже `0.6` → «на решение человеку»; поле длиннее 4 предложений или 600 символов → `oversize`.
- Замер: `triage` — совпадение «оставить/убрать» ≥ 16 из 20 и ни одной записи с разметкой «оставить», получившей `delete` с уверенностью > 0.6; `check` — ≥ 8 из 10.
- Архивы `*-archive.md` скрипт не читает.
- `~/.agents` не под git: коммитов в нём нет. Перед правкой существующих файлов навыка — копия в `~/.claude/_gc_trash/2026-10-01/doc-system/`. Ход работ — комментариями в бид (`bd comments add`).
- Комментарии в коде — по-русски и только там, где неочевидно.

## Review Focus

1. Журнал вне git-репозитория → понятное сообщение и код 2, а не трассировка. (Тест — Task 2.)
2. Jev падает посреди прогона → дальше его не вызываем (не 140 таймаутов подряд), все строки `без Jev`, код 0. (Тест — Task 2.)
3. `|` в заголовке записи ломает markdown-таблицу → экранируется. (Тест — Task 2.)
4. Образцы формата внутри ```` ``` ```` и `<!-- -->` в шапке журнала не считаются записями. (Тест — Task 1.)
5. `UTF-8`, `SHA-256` и подобные не принимаются за номера задач; пути под `/var` → `/private/var` на macOS дают правильные относительные пути. (Тесты — Task 1.)

---

### Task 0: Бид с критериями приёмки

**Files:** нет (трекер `~/.claude/.beads`).

- [ ] **Step 1: Сверить синтаксис**

Run: `cd ~/.claude && bd create --help | head -40`

- [ ] **Step 2: Создать бид**

```bash
cd ~/.claude && bd create "doc-system: journal-jev.py (triage/check) + замер Jev" \
  -d "Спека: docs/superpowers/specs/2026-10-01-doc-system-jev-design.md. План: docs/superpowers/plans/2026-10-01-doc-system-jev.md.
Критерии:
1) python3 ~/.agents/skills/doc-system/scripts/journal-jev.py --selftest → 'selftest: ok', код 0.
2) triage на psychologist-backoffice/docs/journal печатает таблицу по всем записям decisions/gotchas/glossary, файлы журнала не изменены (git -C ~/Developer/psychologist-backoffice status --short docs/journal пуст до и после).
3) Замер triage: совпадение >=16/20 и 0 ложных delete>0.6; замер check: >=8/10. Таблицы совпадений — комментарием в бид.
4) SKILL.md шаг 2b, 'Что НЕ делать' и references/agents-journal-section.md обновлены по итогам замера; grep journal-jev.py в обоих файлах находит строки." \
  -l "src/main"
```

Expected: печатает ID бида (`claude-…`). Затем `bd update <ID> --status in_progress`.

---

### Task 1: Разбор журнала и механические сигналы

**Files:**
- Create: `~/.agents/skills/doc-system/scripts/journal-jev.py`

**Interfaces:**
- Produces:
  - `parse_entries(text: str, source: str) -> list[dict]` — ключи `file`, `title`, `date` (`str|None`), `body`, `fields` (`dict[str,str]`).
  - `repo_root_of(directory: Path) -> Path|None` — корень git, `resolve()`-нутый.
  - `entry_signals(entry: dict, journal_dir: Path, repo_root: Path) -> dict` — ключи `paths`, `paths_missing` (`list[str]`), `code_changed` (`int|None`), `oversize` (`list[str]`), `chronicle` (`list[str]`).
  - `oversize_fields(fields) -> list[str]`, `chronicle_marks(text) -> list[str]`.
  - Константы `JOURNAL_FILES`, `CODE_FIELD`, `CONFIDENCE_FLOOR`, `NO_JEV`, `DATE_RE`.
  - `_selftest_repo(tmp: Path) -> tuple[Path, str]` (журнал, SHA первого коммита), `selftest() -> int`.

- [ ] **Step 1: Написать файл с проверками и заглушками сигналов**

````python
#!/usr/bin/env python3
"""Сигналы устаревания и совет Jev по записям docs/journal/ (навык doc-system).

triage <docs/journal>  — таблица по всем записям активных файлов, журнал не правит.
check [--journal DIR]  — черновик новой записи из stdin → куда его относить.
--selftest             — встроенные проверки на временном git-репозитории.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

JOURNAL_FILES = ("decisions.md", "gotchas.md", "glossary.md")
CODE_FIELD = "Где это в коде"
CONFIDENCE_FLOOR = 0.6
MAX_FIELD_SENTENCES = 4
MAX_FIELD_CHARS = 600
SIMILAR_TITLE_JACCARD = 0.5
JEV_TIMEOUT_S = 30
NO_JEV = "без Jev"

DATE_RE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
FIELD_RE = re.compile(r"^\*\*([^*]+?):\*\*\s*(.*)$")
ANCHOR_RE = re.compile(r"([\w./-]+\.\w+)(?::[\w.$]+)?\s*@\s*([0-9a-f]{7,40})\b")
BACKTICK_RE = re.compile(r"`([^`\s]+)`")
MDLINK_RE = re.compile(r"\]\(([^)\s#]+)")
TRACKER_KEY_RE = re.compile(r"\b([A-Z]{2,})-\d+\b")
BRANCH_RE = re.compile(r"\bbd-[a-z0-9][\w.]*|\bfeature/[\w./-]+")
# Стандарты и алгоритмы выглядят как ключи задач, но ими не являются.
NOT_TRACKER_PREFIXES = {"UTF", "ISO", "SHA", "RFC", "CVE", "ES", "HTTP", "TLS", "WCAG", "AES", "RSA"}
SENTENCE_END_RE = re.compile(r"[.!?…](?=\s|$)")
WORD_RE = re.compile(r"\w{4,}")


def parse_entries(text, source):
    return []


def repo_root_of(directory):
    return None


def entry_signals(entry, journal_dir, repo_root):
    return {}


SELFTEST_JOURNAL = """# Gotchas

Формат:

```
## YYYY-MM-DD — Заголовок-образец внутри блока кода
```

<!--
## 2026-01-01 — Пример в комментарии
-->

## 2024-06-01 — Свежая запись про живой файл

**Симптом:** Что-то ломается. Второе предложение.
**Где это в коде:** `src/app.py:main`, [README](../../README.md).

## 2024-01-01 — Старая запись про изменившийся файл

**Симптом:** bd-abc и TECH-123 тут не к месту, а UTF-8 и SHA-256 — нормальный текст.
**Где это в коде:** `src/app.py`.

## Запись без даты и без кода

**Симптом:** раз. два. три. четыре. пять.

## 2024-06-01 — Запись с якорем и пропавшим файлом

**Где это в коде:** `src/app.py:main @ {sha}`, [gone](../../src/gone.py).
"""

SELFTEST_GIT_ENV = {
    "GIT_AUTHOR_DATE": "2024-06-01T12:00:00", "GIT_COMMITTER_DATE": "2024-06-01T12:00:00",
    "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t",
}


def _selftest_repo(tmp):
    # tmp не resolve()-ним: на macOS /var → /private/var, это часть проверки.
    env = {**os.environ, **SELFTEST_GIT_ENV}

    def run(*args):
        return subprocess.run(["git", "-C", str(tmp), *args], check=True, capture_output=True, text=True, env=env).stdout

    run("init", "-q")
    (tmp / "src").mkdir()
    (tmp / "src/app.py").write_text("x = 1\n")
    (tmp / "README.md").write_text("r\n")
    run("add", "src/app.py", "README.md")
    run("commit", "-qm", "init")
    sha = run("rev-parse", "HEAD").strip()
    (tmp / "src/app.py").write_text("x = 2\n")
    run("commit", "-qam", "change")
    journal = tmp / "docs/journal"
    journal.mkdir(parents=True)
    (journal / "gotchas.md").write_text(SELFTEST_JOURNAL.replace("{sha}", sha), encoding="utf-8")
    return journal, sha


def _selftest_signals(journal):
    entries = parse_entries((journal / "gotchas.md").read_text(encoding="utf-8"), "gotchas.md")
    assert len(entries) == 4, [e["title"] for e in entries]
    fresh, old, undated, anchored = entries
    assert fresh["date"] == "2024-06-01" and undated["date"] is None, entries
    repo_root, journal_dir = repo_root_of(journal), journal.resolve()

    s = entry_signals(fresh, journal_dir, repo_root)
    assert s["paths"] == ["src/app.py", "README.md"], s
    # Коммиты в день записи не считаются изменением после неё.
    assert s["paths_missing"] == [] and s["code_changed"] == 0, s

    s = entry_signals(old, journal_dir, repo_root)
    assert s["code_changed"] == 2, s
    assert s["chronicle"] == ["TECH-123", "bd-abc"], s

    s = entry_signals(undated, journal_dir, repo_root)
    assert s["paths"] == [] and s["code_changed"] is None, s
    assert s["oversize"] == ["Симптом"], s

    s = entry_signals(anchored, journal_dir, repo_root)
    assert s["code_changed"] == 1, s
    assert s["paths_missing"] == ["src/gone.py"], s


def selftest():
    with tempfile.TemporaryDirectory() as tmp:
        journal, _sha = _selftest_repo(Path(tmp))
        _selftest_signals(journal)
    print("selftest: ok")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)
    if args.selftest:
        return selftest()
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
````

- [ ] **Step 2: Убедиться, что проверки падают**

Run: `python3 ~/.agents/skills/doc-system/scripts/journal-jev.py --selftest`
Expected: `AssertionError: []` (записи не разобраны).

- [ ] **Step 3: Заменить три заглушки реализацией**

Заменить `parse_entries`, `repo_root_of`, `entry_signals` (заглушки) на:

```python
def _strip_comments(text):
    return re.sub(r"<!--.*?-->", "", text, flags=re.S)


def parse_entries(text, source):
    entries, current, in_fence = [], None, False
    for line in _strip_comments(text).splitlines():
        if line.startswith("```"):
            in_fence = not in_fence
        if line.startswith("## ") and not in_fence:
            current = {"file": source, "title": line[3:].strip(), "lines": []}
            entries.append(current)
        elif current is not None:
            current["lines"].append(line)
    return [_finish_entry(e) for e in entries]


def _finish_entry(entry):
    body = "\n".join(entry.pop("lines")).strip()
    date = DATE_RE.search(entry["title"])
    return {**entry, "date": date.group(1) if date else None, "body": body, "fields": _parse_fields(body)}


def _parse_fields(body):
    fields, name = {}, None
    for line in body.splitlines():
        match = FIELD_RE.match(line)
        if match:
            name = match.group(1).strip()
            fields[name] = match.group(2).strip()
        elif name and line.strip():
            fields[name] += " " + line.strip()
    return fields


def _git(repo_root, *args):
    result = subprocess.run(["git", "-C", str(repo_root), *args], capture_output=True, text=True)
    return result.stdout if result.returncode == 0 else None


def repo_root_of(directory):
    out = _git(directory, "rev-parse", "--show-toplevel")
    return Path(out.strip()).resolve() if out else None


def _looks_like_path(text):
    return "/" in text or re.search(r"\.[A-Za-z]\w*$", text) is not None


def extract_paths(code_field, journal_dir, repo_root):
    found = {}
    for path, sha in ANCHOR_RE.findall(code_field):
        found[path] = sha
    for raw in BACKTICK_RE.findall(code_field):
        path = raw.split(":")[0]
        if _looks_like_path(path):
            found.setdefault(path, None)
    for raw in MDLINK_RE.findall(code_field):
        if ":" in raw:
            continue
        found.setdefault(os.path.relpath((journal_dir / raw).resolve(), repo_root), None)
    return [{"path": path, "sha": sha} for path, sha in found.items()]


def count_code_changes(paths, date, repo_root):
    commits, known = set(), False
    for item in paths:
        if not (repo_root / item["path"]).exists():
            continue
        if item["sha"]:
            out = _git(repo_root, "log", "--format=%H", f"{item['sha']}..HEAD", "--", item["path"])
        elif date:
            # Конец дня записи: коммит, к которому запись писалась, изменением не считается.
            out = _git(repo_root, "log", "--format=%H", f"--since={date} 23:59:59", "--", item["path"])
        else:
            continue
        if out is None:
            continue
        known = True
        commits.update(out.split())
    return len(commits) if known else None


def oversize_fields(fields):
    return [name for name, text in fields.items()
            if name != CODE_FIELD
            and (len(text) > MAX_FIELD_CHARS or len(SENTENCE_END_RE.findall(text)) > MAX_FIELD_SENTENCES)]


def chronicle_marks(text):
    keys = [m.group(0) for m in TRACKER_KEY_RE.finditer(text) if m.group(1) not in NOT_TRACKER_PREFIXES]
    return sorted(set(keys + BRANCH_RE.findall(text)))


def entry_signals(entry, journal_dir, repo_root):
    paths = extract_paths(entry["fields"].get(CODE_FIELD, ""), journal_dir, repo_root)
    return {
        "paths": [p["path"] for p in paths],
        "paths_missing": [p["path"] for p in paths if not (repo_root / p["path"]).exists()],
        "code_changed": count_code_changes(paths, entry["date"], repo_root),
        "oversize": oversize_fields(entry["fields"]),
        "chronicle": chronicle_marks(entry["body"]),
    }
```

- [ ] **Step 4: Проверки проходят**

Run: `python3 ~/.agents/skills/doc-system/scripts/journal-jev.py --selftest`
Expected: `selftest: ok`, код 0.

- [ ] **Step 5: Отметить в биде**

Run: `cd ~/.claude && bd comments add <ID> "Task 1 готов: разбор + сигналы, selftest ok"`

---

### Task 2: Вызов Jev и режим `triage`

**Files:**
- Modify: `~/.agents/skills/doc-system/scripts/journal-jev.py`

**Interfaces:**
- Consumes: `parse_entries`, `repo_root_of`, `entry_signals`, `JOURNAL_FILES`, `CONFIDENCE_FLOOR`, `NO_JEV`, `_selftest_repo`.
- Produces:
  - `ask_jev(state: str, questions: list) -> tuple[dict|None, str|None]` — (`answers`, причина отказа).
  - `entry_state(entry: dict, signals: dict) -> str`.
  - `triage(journal_dir: Path, use_jev: bool = True) -> list[dict]` — строки с ключами сигналов плюс `file`, `title`, `action` (`str|None`), `confidence` (`float|None`), `derivable`, `hypothesis` (`float|None`), `needs_human` (`bool`).
  - `format_triage(rows) -> str`.
  - `_fake_bin(tmp: Path, jev_body: str|None) -> Path` — каталог для `PATH` с `git` и (если задан) фальшивым `jev`; `FAKE_ANSWERS: dict`.

- [ ] **Step 1: Дописать проверки**

Добавить перед `def selftest():`

```python
FAKE_ANSWERS = {"answers": {
    "action": {"type": "choice", "choice": "delete", "probabilities": {}, "confidence": 0.5},
    "derivable": {"type": "noul", "noul": 0.1},
    "hypothesis": {"type": "noul", "noul": 0.9},
    "carrier": {"type": "choice", "choice": "code_comment", "probabilities": {}, "confidence": 0.8},
}}


def _fake_bin(tmp, jev_body):
    bin_dir = Path(tempfile.mkdtemp(dir=tmp))
    (bin_dir / "git").symlink_to(shutil.which("git"))
    if jev_body is not None:
        jev = bin_dir / "jev"
        jev.write_text("#!/bin/sh\n" + jev_body)
        jev.chmod(0o755)
    return bin_dir


def _with_path(bin_dir, fn):
    saved = os.environ["PATH"]
    os.environ["PATH"] = str(bin_dir)
    try:
        return fn()
    finally:
        os.environ["PATH"] = saved


def _selftest_triage(journal, tmp):
    rows = _with_path(_fake_bin(tmp, None), lambda: triage(journal))
    assert len(rows) == 4 and all(r["action"] is None for r in rows), rows
    assert rows[0]["title"].endswith("пропавшим файлом"), [r["title"] for r in rows]
    assert NO_JEV in format_triage(rows)

    answer_file = tmp / "answers.json"
    answer_file.write_text(json.dumps(FAKE_ANSWERS))
    good_jev = _fake_bin(tmp, f"/bin/cat > /dev/null\n/bin/cat '{answer_file}'\n")
    rows = _with_path(good_jev, lambda: triage(journal))
    assert all(r["action"] == "delete" and r["needs_human"] for r in rows), rows
    assert rows[0]["hypothesis"] == 0.9 and "на решение человеку" in format_triage(rows), rows

    calls = tmp / "calls.log"
    broken_jev = _fake_bin(tmp, f"echo x >> '{calls}'\nexit 1\n")
    rows = _with_path(broken_jev, lambda: triage(journal))
    assert all(r["action"] is None for r in rows), rows
    assert calls.read_text().count("x") == 1, "после первого отказа Jev больше не вызывается"

    piped = format_triage([{**rows[0], "title": "a | b"}])
    assert "a \\| b" in piped, piped

    outside = tmp / "not-a-repo"
    outside.mkdir()
    try:
        triage(outside, use_jev=False)
    except SystemExit as exit_:
        assert "git" in str(exit_.code), exit_.code
    else:
        raise AssertionError("журнал вне git должен отклоняться")
```

И в `selftest()` после `_selftest_signals(journal)` добавить строку:

```python
        _selftest_triage(journal, Path(tmp))
```

- [ ] **Step 2: Убедиться, что падают**

Run: `python3 ~/.agents/skills/doc-system/scripts/journal-jev.py --selftest`
Expected: `NameError: name 'triage' is not defined`.

- [ ] **Step 3: Реализация**

Добавить после `entry_signals`:

```python
TRIAGE_QUESTIONS = [
    {"id": "action", "type": "choice",
     "instructions": "What should happen to this project-journal entry? Signals were computed mechanically from git and the filesystem.",
     "criteria": {
         "keep": "Still true, useful, and concise",
         "compress": "Still true but longer than it needs to be, or narrates work history",
         "archive": "No longer true, but explains why a past workaround existed",
         "delete": "No longer true and explains nothing worth keeping"}},
    {"id": "derivable", "type": "noul",
     "instructions": "A developer would learn this fact just by reading the referenced code"},
    {"id": "hypothesis", "type": "noul",
     "instructions": "The stated cause is a guess, not a confirmed finding"},
]
ACTION_RANK = {"delete": 0, "archive": 1, "compress": 2, "keep": 3}


def ask_jev(state, questions):
    # stderr самого jev не пересказываем: там могут быть подробности ключа.
    if shutil.which("jev") is None:
        return None, "jev не найден в PATH"
    payload = json.dumps({"state": state, "questions": questions}, ensure_ascii=False)
    try:
        result = subprocess.run(["jev", "ask"], input=payload, capture_output=True, text=True, timeout=JEV_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        return None, f"jev ask: таймаут {JEV_TIMEOUT_S} с"
    if result.returncode != 0:
        return None, f"jev ask: код выхода {result.returncode}"
    try:
        return json.loads(result.stdout)["answers"], None
    except (json.JSONDecodeError, KeyError):
        return None, "jev ask: непонятный ответ"


def entry_state(entry, signals):
    return (f"Journal file: {entry['file']}\nEntry: ## {entry['title']}\n{entry['body']}\n\n"
            f"Signals: {json.dumps(signals, ensure_ascii=False)}")


def _triage_row(entry, signals, answers):
    action = answers["action"] if answers else None
    confidence = action["confidence"] if action else None
    return {
        "file": entry["file"], "title": entry["title"], **signals,
        "action": action["choice"] if action else None,
        "confidence": confidence,
        "derivable": answers["derivable"]["noul"] if answers else None,
        "hypothesis": answers["hypothesis"]["noul"] if answers else None,
        "needs_human": confidence is not None and confidence < CONFIDENCE_FLOOR,
    }


def triage(journal_dir, use_jev=True):
    journal_dir = Path(journal_dir).resolve()
    repo_root = repo_root_of(journal_dir)
    if repo_root is None:
        raise SystemExit(f"{journal_dir}: не внутри git-репозитория")
    jev_down = None if use_jev else NO_JEV
    rows = []
    for name in JOURNAL_FILES:
        path = journal_dir / name
        if not path.exists():
            continue
        for entry in parse_entries(path.read_text(encoding="utf-8"), name):
            signals = entry_signals(entry, journal_dir, repo_root)
            answers = None
            if jev_down is None:
                answers, jev_down = ask_jev(entry_state(entry, signals), TRIAGE_QUESTIONS)
                if jev_down:
                    print(jev_down, file=sys.stderr)
            rows.append(_triage_row(entry, signals, answers))
    return sorted(rows, key=lambda r: (ACTION_RANK.get(r["action"], 4),
                                       -len(r["paths_missing"]), -(r["code_changed"] or 0)))


def _cell(text):
    return str(text).replace("|", "\\|")


def _describe_signals(row):
    parts = []
    if row["paths_missing"]:
        parts.append("нет путей: " + ", ".join(row["paths_missing"]))
    if row["code_changed"]:
        parts.append(f"код менялся: {row['code_changed']} комм.")
    if row["oversize"]:
        parts.append("длинно: " + ", ".join(row["oversize"]))
    if row["chronicle"]:
        parts.append("хроника: " + ", ".join(row["chronicle"]))
    if not row["paths"]:
        parts.append("без ссылок на код")
    return "; ".join(parts) or "—"


def _verdict_label(row):
    if row["action"] is None:
        return NO_JEV
    return row["action"] + (" · на решение человеку" if row["needs_human"] else "")


def format_triage(rows):
    lines = ["| файл | запись | сигналы | вердикт | уверенность |", "|---|---|---|---|---|"]
    for row in rows:
        confidence = "—" if row["confidence"] is None else f"{row['confidence']:.2f}"
        lines.append("| " + " | ".join(_cell(c) for c in (
            row["file"], row["title"], _describe_signals(row), _verdict_label(row), confidence)) + " |")
    return "\n".join(lines)
```

Заменить `main` целиком:

```python
def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--selftest", action="store_true")
    sub = parser.add_subparsers(dest="mode")
    triage_parser = sub.add_parser("triage")
    triage_parser.add_argument("journal", type=Path)
    triage_parser.add_argument("--no-jev", action="store_true")
    triage_parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.selftest:
        return selftest()
    if args.mode == "triage":
        rows = triage(args.journal, use_jev=not args.no_jev)
        print(json.dumps(rows, ensure_ascii=False, indent=2) if args.json else format_triage(rows))
        return 0
    parser.print_help()
    return 2
```

- [ ] **Step 4: Проверки проходят**

Run: `python3 ~/.agents/skills/doc-system/scripts/journal-jev.py --selftest`
Expected: `selftest: ok`.

- [ ] **Step 5: Прогон на живом журнале без Jev, журнал не тронут**

```bash
git -C ~/Developer/psychologist-backoffice status --short docs/journal
```
```bash
python3 ~/.agents/skills/doc-system/scripts/journal-jev.py triage ~/Developer/psychologist-backoffice/docs/journal --no-jev | head -20
```
```bash
git -C ~/Developer/psychologist-backoffice status --short docs/journal
```
Expected: таблица; вывод `status` до и после одинаковый.

- [ ] **Step 6: Отметить в биде** — `bd comments add <ID> "Task 2 готов: triage, selftest ok, живой прогон без Jev ok"`.

---

### Task 3: Режим `check`

**Files:**
- Modify: `~/.agents/skills/doc-system/scripts/journal-jev.py`

**Interfaces:**
- Consumes: `parse_entries`, `oversize_fields`, `chronicle_marks`, `ask_jev`, `entry_state`, `_fake_bin`, `_with_path`, `FAKE_ANSWERS`.
- Produces: `check(draft: str, journal_dir: Path|None, use_jev: bool = True) -> dict` — ключи `carrier` (`str|None`), `confidence` (`float|None`), `remarks` (`list[str]`); `format_check(result) -> str`.

- [ ] **Step 1: Дописать проверки**

Добавить перед `def selftest():`

```python
def _selftest_check(journal, tmp):
    answer_file = tmp / "answers.json"
    good_jev = _fake_bin(tmp, f"/bin/cat > /dev/null\n/bin/cat '{answer_file}'\n")
    draft = ("## 2024-07-01 — Свежая запись про живой файл, снова\n\n"
             "**Симптом:** правка по TECH-9.\n**Причина:** наверное кэш.\n")
    result = _with_path(good_jev, lambda: check(draft, journal))
    assert result["carrier"] == "code_comment" and result["confidence"] == 0.8, result
    remarks = " ".join(result["remarks"])
    for expected in (CODE_FIELD, "TECH-9", "Свежая запись", "[гипотеза]"):
        assert expected in remarks, (expected, result)
    assert "code_comment" in format_check(result)

    clean = check("## Термин\n\n**Определение:** коротко.\n", journal, use_jev=False)
    assert clean == {"carrier": None, "confidence": None, "remarks": []}, clean
    assert "замечаний нет" in format_check(clean)

    try:
        check("   ", journal, use_jev=False)
    except SystemExit:
        pass
    else:
        raise AssertionError("пустой черновик должен отклоняться")
```

В `selftest()` после `_selftest_triage(journal, Path(tmp))` — строка:

```python
        _selftest_check(journal, Path(tmp))
```

(`answers.json` уже записан в `_selftest_triage`.)

- [ ] **Step 2: Убедиться, что падают**

Run: `python3 ~/.agents/skills/doc-system/scripts/journal-jev.py --selftest`
Expected: `NameError: name 'check' is not defined`.

- [ ] **Step 3: Реализация**

Добавить после `format_triage`:

```python
CHECK_QUESTIONS = [
    {"id": "carrier", "type": "choice", "instructions": "Where does this draft note belong?",
     "criteria": {
         "code_comment": "Explains one place in the code; belongs in a comment next to that code",
         "gotcha": "A trap that spans several files or is invisible from the code",
         "decision": "An architectural decision with its reasoning",
         "glossary": "Defines a domain term",
         "not_journal": "Task status, a narrative of work done, or something the code already says"}},
    TRIAGE_QUESTIONS[2],
]


def _title_words(title):
    return {w.lower() for w in WORD_RE.findall(DATE_RE.sub("", title))}


def similar_titles(title, journal_dir):
    words = _title_words(title)
    if not words or journal_dir is None or not journal_dir.is_dir():
        return []
    similar = []
    for name in JOURNAL_FILES:
        path = journal_dir / name
        if not path.exists():
            continue
        for entry in parse_entries(path.read_text(encoding="utf-8"), name):
            other = _title_words(entry["title"])
            if other and len(words & other) / len(words | other) >= SIMILAR_TITLE_JACCARD:
                similar.append(f"{name}: {entry['title']}")
    return similar


def check(draft, journal_dir, use_jev=True):
    if not draft.strip():
        raise SystemExit("пустой черновик")
    text = draft if draft.lstrip().startswith("## ") else "## " + draft.lstrip()
    entry = parse_entries(text, "draft")[0]
    remarks = []
    # Поле обязательно только в формате подводного камня; у решений и терминов его может не быть.
    if "Симптом" in entry["fields"] and CODE_FIELD not in entry["fields"]:
        remarks.append(f"нет поля «{CODE_FIELD}»")
    remarks += [f"длинно: {name}" for name in oversize_fields(entry["fields"])]
    marks = chronicle_marks(entry["title"] + "\n" + entry["body"])
    if marks:
        remarks.append("хроника: " + ", ".join(marks))
    remarks += [f"похоже на: {t}" for t in similar_titles(entry["title"], journal_dir)]
    answers, reason = ask_jev(entry_state(entry, {"remarks": remarks}), CHECK_QUESTIONS) if use_jev else (None, None)
    if reason:
        print(reason, file=sys.stderr)
    if answers and answers["hypothesis"]["noul"] >= CONFIDENCE_FLOOR and "[гипотеза]" not in entry["body"]:
        remarks.append("похоже на догадку без метки [гипотеза]")
    carrier = answers["carrier"] if answers else None
    return {"carrier": carrier["choice"] if carrier else None,
            "confidence": carrier["confidence"] if carrier else None,
            "remarks": remarks}


def format_check(result):
    if result["carrier"] is None:
        verdict = NO_JEV
    else:
        verdict = f"{result['carrier']} ({result['confidence']:.2f})"
        if result["confidence"] < CONFIDENCE_FLOOR:
            verdict += " · на решение человеку"
    return f"{verdict} — " + ("; ".join(result["remarks"]) or "замечаний нет")
```

Заменить `main` целиком:

```python
def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--selftest", action="store_true")
    sub = parser.add_subparsers(dest="mode")
    triage_parser = sub.add_parser("triage")
    triage_parser.add_argument("journal", type=Path)
    check_parser = sub.add_parser("check")
    check_parser.add_argument("--journal", type=Path, default=Path("docs/journal"))
    for mode_parser in (triage_parser, check_parser):
        mode_parser.add_argument("--no-jev", action="store_true")
        mode_parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    if args.selftest:
        return selftest()
    if args.mode == "triage":
        rows = triage(args.journal, use_jev=not args.no_jev)
        print(json.dumps(rows, ensure_ascii=False, indent=2) if args.json else format_triage(rows))
        return 0
    if args.mode == "check":
        result = check(sys.stdin.read(), args.journal.resolve(), use_jev=not args.no_jev)
        print(json.dumps(result, ensure_ascii=False) if args.json else format_check(result))
        return 0
    parser.print_help()
    return 2
```

- [ ] **Step 4: Проверки проходят**

Run: `python3 ~/.agents/skills/doc-system/scripts/journal-jev.py --selftest`
Expected: `selftest: ok`.

- [ ] **Step 5: Живой вызов с настоящим Jev**

```bash
printf '## 2026-10-01 — Кнопка сохранения\n\n**Симптом:** в этой функции стоит debounce 300 мс, потому что бэкенд не выдерживает частые запросы.\n**Где это в коде:** `src/a.ts`.\n' | python3 ~/.agents/skills/doc-system/scripts/journal-jev.py check --journal ~/Developer/psychologist-backoffice/docs/journal
```
Expected: одна строка с вердиктом и уверенностью (ожидаемо `code_comment`), код 0.

- [ ] **Step 6: Отметить в биде** — `bd comments add <ID> "Task 3 готов: check, selftest ok, живой Jev отвечает"`.

---

### Task 4: Замер пользы Jev

**Files:** только scratchpad сессии (`$S` ниже); в репозитории ничего.

- [ ] **Step 1: Выборка без Jev**

```bash
S=<scratchpad>; python3 ~/.agents/skills/doc-system/scripts/journal-jev.py triage ~/Developer/psychologist-backoffice/docs/journal --no-jev --json > "$S/signals.json"
```
```bash
S=<scratchpad>; python3 - "$S" <<'EOF'
import json, sys
s = sys.argv[1]
rows = [r for r in json.load(open(f"{s}/signals.json")) if r["file"] == "gotchas.md"]
dated = sorted((r for r in rows if r["title"][:10].count("-") == 2), key=lambda r: r["title"][:10])
sample = [r["title"] for r in dated[:10] + dated[-10:]]
assert len(sample) == 20, len(sample)
json.dump(sample, open(f"{s}/sample.json", "w"), ensure_ascii=False, indent=1)
print("\n".join(sample))
EOF
```

- [ ] **Step 2: Ручная разметка — ДО прогона Jev**

Основная модель читает 20 записей в `gotchas.md` и код по ссылкам, ставит каждой `keep|compress|archive|delete` и пишет `$S/labels.json` вида `{"<заголовок>": "keep", ...}`. Сводку отправить пользователю на выборочную проверку; правки пользователя внести в `labels.json`. Вердикты Jev до этого не открывать.

- [ ] **Step 3: Прогон Jev и сравнение**

```bash
S=<scratchpad>; python3 ~/.agents/skills/doc-system/scripts/journal-jev.py triage ~/Developer/psychologist-backoffice/docs/journal --json > "$S/jev.json"
```
```bash
S=<scratchpad>; python3 - "$S" <<'EOF'
import json, sys
s = sys.argv[1]
labels = json.load(open(f"{s}/labels.json"))
jev = {r["title"]: r for r in json.load(open(f"{s}/jev.json")) if r["file"] == "gotchas.md"}
side = lambda a: "keep" if a in ("keep", "compress") else "remove"
agree, false_deletes = 0, []
for title, label in labels.items():
    row = jev[title]
    agree += side(label) == side(row["action"])
    if side(label) == "keep" and row["action"] == "delete" and row["confidence"] > 0.6:
        false_deletes.append(title)
    print(f"{label:9} {row['action']!s:9} {row['confidence']}  {title}")
print(f"совпало {agree}/20; ложных delete>0.6: {len(false_deletes)}")
print("ПРОШЁЛ" if agree >= 16 and not false_deletes else "НЕ ПРОШЁЛ")
EOF
```

- [ ] **Step 4: Замер `check`**

Записать `$S/drafts.json` — 10 черновиков `[{"expected": "<carrier>", "text": "<запись>"}]`: по 2 на `code_comment`, `gotcha`, `decision`, `not_journal` и 2 на `glossary`, правдоподобных для этого проекта.

```bash
S=<scratchpad>; python3 - "$S" <<'EOF'
import json, subprocess, sys
s = sys.argv[1]
script = "/Users/ascurse/.agents/skills/doc-system/scripts/journal-jev.py"
hits = 0
for d in json.load(open(f"{s}/drafts.json")):
    out = subprocess.run(["python3", script, "check", "--json", "--journal",
                          "/Users/ascurse/Developer/psychologist-backoffice/docs/journal"],
                         input=d["text"], capture_output=True, text=True, check=True).stdout
    got = json.loads(out)["carrier"]
    hits += got == d["expected"]
    print(f"{d['expected']:12} {got}")
print(f"check: {hits}/10 —", "ПРОШЁЛ" if hits >= 8 else "НЕ ПРОШЁЛ")
EOF
```

- [ ] **Step 5: Итоги в бид**

`bd comments add <ID> "<вывод обоих сравнений целиком + решение: что встраиваем>"`. Если хоть один замер не прошёл — сказать пользователю до Task 5 и получить «да» на урезанный вариант.

---

### Task 5: Встраивание в навык

**Files:**
- Modify: `~/.agents/skills/doc-system/SKILL.md` (шаг 2b ~строка 78, «Что НЕ делать» ~строка 163)
- Modify: `~/.agents/skills/doc-system/references/agents-journal-section.md`
- Modify (только если замер `triage` не прошёл): `journal-jev.py`

- [ ] **Step 1: Резервные копии**

```bash
mkdir -p ~/.claude/_gc_trash/2026-10-01/doc-system/references
```
```bash
cp ~/.agents/skills/doc-system/SKILL.md ~/.claude/_gc_trash/2026-10-01/doc-system/SKILL.md
```
```bash
cp ~/.agents/skills/doc-system/references/agents-journal-section.md ~/.claude/_gc_trash/2026-10-01/doc-system/references/
```

- [ ] **Step 2: Шаг 2b в `SKILL.md`**

Вставить перед строкой, начинающейся с `- **Сожми каждую активную запись до сути**`:

Вариант «замер `triage` прошёл»:

```markdown
- **Сначала таблица, потом суждение.** `python3 ~/.agents/skills/doc-system/scripts/journal-jev.py triage docs/journal` печатает по каждой записи механические сигналы (пропавшие пути, сколько коммитов тронули код после записи, раздутые поля, номера задач) и совет Jev — оставить / сжать / в архив / удалить — с уверенностью. Это основа списка предложений, не решение: каждую запись под архив или удаление покажи пользователю и жди «да» по ней; строки «на решение человеку» — без рекомендации Jev. Без `jev` скрипт выдаёт только сигналы — это штатный режим.
```

Вариант «не прошёл»:

```markdown
- **Сначала таблица, потом суждение.** `python3 ~/.agents/skills/doc-system/scripts/journal-jev.py triage docs/journal` печатает по каждой записи механические сигналы: пропавшие пути, сколько коммитов тронули код после записи, раздутые поля, номера задач. Это основа списка предложений, не решение: каждую запись под архив или удаление покажи пользователю и жди «да» по ней.
```

…и в этом случае в `journal-jev.py` в `main` заменить флаг `--no-jev` на `--jev` (`use_jev=args.jev`), в `_selftest_triage`/`_selftest_check` вызовы без явного `use_jev` оставить как есть (функции по умолчанию по-прежнему спрашивают Jev), прогнать `--selftest`.

- [ ] **Step 3: «Что НЕ делать» в `SKILL.md`**

После строки `- Не включай \`*-archive.md\` в конвенцию чтения/retrieval агента…` добавить (только в варианте «прошёл»):

```markdown
- Не удаляй и не архивируй запись по одному вердикту Jev из `journal-jev.py triage` — это совет; решение по каждой записи за пользователем.
```

- [ ] **Step 4: `agents-journal-section.md`**

После пункта, начинающегося с `- Если запись про конкретный код — в «Где это в коде» ставь якорь`, добавить (только если замер `check` прошёл):

```markdown
- Необязательно: если в окружении есть `jev`, перед записью прогони черновик через `python3 ~/.agents/skills/doc-system/scripts/journal-jev.py check < черновик.md`. Он подскажет, не место ли этому в комментарии рядом с кодом и нет ли уже похожей записи. Это совет, не запрет: нет `jev` — пиши как обычно.
```

- [ ] **Step 5: Проверка**

```bash
grep -n "journal-jev.py" ~/.agents/skills/doc-system/SKILL.md ~/.agents/skills/doc-system/references/agents-journal-section.md
```
```bash
python3 ~/.agents/skills/doc-system/scripts/journal-jev.py --selftest
```
```bash
diff ~/.claude/_gc_trash/2026-10-01/doc-system/SKILL.md ~/.agents/skills/doc-system/SKILL.md
```
Expected: строки найдены в тех файлах, где их добавляли; `selftest: ok`; `diff` показывает только добавленные строки.

- [ ] **Step 6: Самопроверка и закрытие**

Прогнать самопроверку по `implementation-standard` (ревьюер Python-кода, `silent-failure-hunter` — в скрипте есть обработка отказов подпроцессов). Затем `bd close <ID> --reason "Done: journal-jev.py + замер (<итоги>) + навык обновлён; ~/.agents не под git — коммита нет"`.
