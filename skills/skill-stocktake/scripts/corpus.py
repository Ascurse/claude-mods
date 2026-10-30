#!/usr/bin/env python3
"""Корпусные проверки навыков — то, что не видно при взгляде на один файл.

Дополняет lint.sh (пофайловый) и не повторяет его: description, его длину,
пересказ шагов и размер SKILL.md проверяет он. Здесь — только связи между
навыками и цена корпуса целиком.

  FAIL  name во frontmatter не совпадает с именем каталога
  FAIL  ссылка из SKILL.md ведёт на несуществующий файл
  WARN  два описания слишком похожи — модель будет путать навыки при выборе
  WARN  файл лежит в каталоге навыка, но из SKILL.md на него никто не ссылается
  INFO  сколько токенов имена и описания занимают в каждой сессии

Без зависимостей и без сети. Пороги читаются из ~/.claude/thresholds.yaml
(секция skills), значения по умолчанию — в DEFAULTS.

  python3 corpus.py                  # ~/.claude/skills + $PWD/.claude/skills
  python3 corpus.py --json
  python3 corpus.py ~/other/skills
  python3 corpus.py --selfcheck

Идея проверок взята из muratcankoylan/Agent-Skills-for-Context-Engineering
(researcher/scripts/skill_health.py, check_activation_cases.py), MIT.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from itertools import combinations
from pathlib import Path

DEFAULTS = {
    # Доля общих слов в описаниях, выше которой навыки конкурируют за вызов.
    "activation_overlap": 0.30,
    # Сколько похожих пар печатать.
    "overlap_report_limit": 15,
    # Оценка бюджета старта: имена + описания всех навыков, в токенах.
    "startup_budget_tokens": 6000,
}

THRESHOLDS_FILE = Path.home() / ".claude" / "thresholds.yaml"

# Служебные слова и общая лексика описаний: без выброса любые два навыка
# «use when the user asks to…» выглядят похожими.
STOPWORDS = {
    "use", "when", "the", "and", "for", "with", "that", "this", "from", "into",
    "before", "after", "any", "all", "not", "but", "its", "their", "you", "your",
    "user", "users", "asks", "wants", "needs", "task", "tasks", "skill", "skills",
    "claude", "agent", "agents", "triggers", "covers", "also", "than", "then",
    "используй", "когда", "если", "для", "или", "это", "как", "что", "чтобы",
    "пользователь", "просит", "хочет", "нужно", "надо", "уже", "ещё", "еще",
    "задача", "задачи", "навык", "навыка", "скилл", "скилла",
}

WORD = re.compile(r"[^\W\d_][\w-]{2,}", re.UNICODE)
# Ссылки вида [текст](путь) — интересуют только относительные, не http и не якоря.
MD_LINK = re.compile(r"\[[^\]]*\]\(([^)#][^)]*)\)")
FENCE_LINE = re.compile(r"^\s*```")
# Инлайн-код в одинарных бэктиках — там `[name](url)` показывают как пример
# синтаксиса markdown, а не как настоящую ссылку.
INLINE_CODE = re.compile(r"`[^`\n]+`")
SKIP_FILES = {".DS_Store", "results.json", "SKILL.md"}
SKIP_DIRS = {"__pycache__", ".git", "node_modules"}


def read_thresholds() -> dict[str, float]:
    """Точечное чтение секции skills из thresholds.yaml. Полный YAML не нужен."""
    values = dict(DEFAULTS)
    if not THRESHOLDS_FILE.exists():
        return values
    in_section = False
    for line in THRESHOLDS_FILE.read_text(encoding="utf-8").splitlines():
        if re.match(r"^skills:\s*$", line):
            in_section = True
            continue
        if in_section:
            if line and not line.startswith((" ", "\t", "#")):
                break
            m = re.match(r"\s+([a-z_]+):\s*([0-9.]+)", line)
            if m and m.group(1) in values:
                values[m.group(1)] = float(m.group(2))
    return values


def parse_frontmatter(text: str) -> dict[str, str]:
    """name и description, включая блочную форму (> и |)."""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    if end == -1:
        return {}
    block = text[3:end]
    data: dict[str, str] = {}
    key = None
    for line in block.splitlines():
        m = re.match(r"^([a-z][\w-]*):\s*(.*)$", line)
        if m:
            key, value = m.group(1), m.group(2).strip()
            if value in ("", ">", "|", ">-", "|-"):
                data[key] = ""
            else:
                data[key] = value.strip("\"'")
                key = None
        elif key and line.startswith((" ", "\t")):
            data[key] = (data[key] + " " + line.strip()).strip()
    return data


def tokens(text: str) -> set[str]:
    return {w for w in (m.group(0).lower() for m in WORD.finditer(text)) if w not in STOPWORDS}


def jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def discover(roots: list[Path]) -> list[Path]:
    found: list[Path] = []
    seen: set[Path] = set()
    for root in roots:
        # $PWD может совпасть с $HOME — тогда глобальный и проектный корни одни и те же
        real = root.resolve() if root.is_dir() else root
        if root.is_dir() and real not in seen:
            seen.add(real)
            found.extend(sorted(root.glob("*/SKILL.md")))
    return found


def strip_fences(text: str) -> str:
    """Выбросить блоки в тройных кавычках.

    Внутри них лежат шаблоны для вставки в чужой проект: их ссылки указывают на
    файлы целевого репозитория и здесь не должны существовать. Проверять их —
    значит требовать, чтобы шаблон был рабочим по месту написания.
    """
    out, fenced = [], False
    for line in text.splitlines():
        if FENCE_LINE.match(line):
            fenced = not fenced
            continue
        if not fenced:
            out.append(line)
    return "\n".join(out)


def dead_links(skill_dir: Path, text: str) -> list[str]:
    dead = []
    for target in MD_LINK.findall(INLINE_CODE.sub("", strip_fences(text))):
        target = target.split("#", 1)[0].strip()
        if not target or "://" in target or target.startswith(("~", "/", "$")):
            continue
        if not (skill_dir / target).exists():
            dead.append(target)
    return dead


def orphan_files(skill_dir: Path, text: str) -> list[str]:
    """Смотрим только корень навыка и references/.

    Остальные подкаталоги (learnings/, runs/, кэши) навыки наполняют сами во
    время работы — там несвязанный файл это норма, а не находка. Проверка по
    ним давала на порядок больше шума, чем сигнала.
    """
    candidates = [p for p in skill_dir.iterdir()] + list((skill_dir / "references").glob("*"))
    orphans = []
    for path in sorted(candidates):
        if not path.is_file() or path.name in SKIP_FILES or path.name.startswith("."):
            continue
        rel = str(path.relative_to(skill_dir))
        # Достаточно упоминания имени файла где угодно в теле — ссылки бывают
        # и в виде кода, и внутри bash-команд, не только markdown-ссылкой.
        if rel not in text and path.name not in text:
            orphans.append(rel)
    return orphans


# Слово рядом с `именем` означает, что это отсылка к навыку, а не к CSS-классу
# или методу API. Без этого условия в выборку лезут h-screen, line-height и
# useEffect — их в теле дизайн-навыков на порядок больше, чем настоящих ссылок.
# Отсылка к соседнему навыку бывает в трёх видах: в бэктиках, голым именем
# после see/use/invoke и ячейкой таблицы фаз. Бэктики необязательны — в
# описаниях навыки перечисляют друг друга просто через запятую.
SKILL_REF_INLINE = re.compile(
    r"(?:skill|Related|Отличие от|отсыла\w*|навык\w*|скил\w*|\bsee\b|\binvoke\b)"
    r"[^.\n]{0,60}?`?\b([a-z][a-z-]{4,40}[a-z])\b`?",
    re.IGNORECASE,
)
ACKNOWLEDGED = re.compile(r"not installed|не установлен|отсутствует", re.IGNORECASE)
SKILL_REF_CELL = re.compile(r"^\|[^|\n]*\|\s*([a-z][a-z-]{4,40}[a-z])\s*\|", re.MULTILINE)

# Кебаб-имена, которые никогда не навыки: CSS-утилиты, свойства, media-фичи и
# служебные термины (аргументы CLI, ключи frontmatter), пойманные регэкспом
# из-за случайного соседства со словом "skill"/"навык" в тексте.
# Держим списком, а не эвристикой: jobs-to-be-done и grid-flow-dense устроены
# одинаково, никакое правило о форме их не разделит.
NOT_A_SKILL = re.compile(
    r"^(?:h-|w-|p[xytblr]?-|m[xytblr]?-|max-|min-|gap-|grid-|flex-|z-|text-|bg-|border-"
    r"|rounded-|shadow-|space-|divide-|overflow-|backdrop-|ease-|cubic-|prefers-|safe-"
    r"|font-|leading-|tracking-|aspect-|object-|scroll-|snap-|will-|line-|letter-|word-)"
    r"|^(?:html-tailwind|dark-mode|box-sizing|pointer-events|mix-blend|clip-path"
    r"|disable-model-invocation|review-id|non-empty|comma-separated|project-level)$"
)


def dead_skill_refs(text: str, description: str, me: str, known: set[str]) -> list[str]:
    """Имена навыков, на которые ссылается текст, но которых нет на диске."""
    # Только триггерные конструкции. Сплошной скан по описанию пробовался и
    # утонул в дефисных прилагательных: award-winning и evidence-backed
    # неотличимы по форме от jobs-to-be-done.
    # Тройные кавычки вырезаем и здесь: внутри шаблонов лежат чужие примеры
    # (JSON-ключи вроде "skill-name"), а не отсылки к реальным навыкам.
    body = strip_fences(text)
    found = set(SKILL_REF_INLINE.findall(description))
    found |= set(SKILL_REF_INLINE.findall(body))
    found |= set(SKILL_REF_CELL.findall(body))
    dead = set()
    for name in found:
        if name == me or name in known or "-" not in name or NOT_A_SKILL.match(name.lower()):
            continue
        # Отсутствие, объявленное в самом файле, — не висячая ссылка, а честная
        # пометка. Иначе проверка вечно кричит на маркетплейсные пакеты, которые
        # уже разметили свои недостающие навыки.
        if any(ACKNOWLEDGED.search(text[m.end():m.end() + 60])
               for m in re.finditer(re.escape(name), text)):
            continue
        dead.add(name)
    return sorted(dead)


def installed_skills(roots: list[Path]) -> set[str]:
    """Все навыки, видимые харнесу, включая соседние каталоги других агентов."""
    names: set[str] = set()
    for root in roots + [Path.home() / ".agents" / "skills", Path.home() / ".codex" / "skills"]:
        if root.is_dir():
            names |= {d.name for d in root.iterdir() if d.is_dir()}
    # Плагинные навыки каталогами в skills/ не лежат, но ссылаться на них законно.
    plugins = Path.home() / ".claude" / "plugins"
    if plugins.is_dir():
        names |= {d.name for d in plugins.rglob("skills/*") if d.is_dir()}
    return names


def read_skill_overrides() -> dict[str, str]:
    """settings.json может принудительно снять навык с автовызова.

    corpus.py без этого считает такой навык модель-видимым и завышает бюджет старта.
    """
    overrides: dict[str, str] = {}
    for name in ("settings.json", "settings.local.json"):
        path = Path.home() / ".claude" / name
        if not path.is_file():
            continue
        try:
            overrides.update(json.loads(path.read_text(encoding="utf-8")).get("skillOverrides", {}))
        except (json.JSONDecodeError, OSError):
            continue
    return overrides


def analyze(paths: list[Path], limits: dict[str, float]) -> dict:
    skills = []
    problems = []
    known_skills = installed_skills([p.parent.parent for p in paths])
    overrides = read_skill_overrides()
    for path in paths:
        text = path.read_text(encoding="utf-8", errors="replace")
        fm = parse_frontmatter(text)
        directory = path.parent
        name = fm.get("name", "")
        if name != directory.name:
            problems.append({
                "level": "FAIL", "skill": directory.name, "check": "name",
                "detail": f"name={name!r} не совпадает с каталогом {directory.name!r}",
            })
        for target in dead_links(directory, text):
            problems.append({
                "level": "FAIL", "skill": directory.name, "check": "link",
                "detail": f"ссылка на несуществующий {target}",
            })
        for rel in orphan_files(directory, text):
            problems.append({
                "level": "WARN", "skill": directory.name, "check": "orphan",
                "detail": f"{rel} не упомянут в SKILL.md",
            })
        for ref in dead_skill_refs(text, fm.get("description", ""), directory.name, known_skills):
            problems.append({
                "level": "WARN", "skill": directory.name, "check": "skillref",
                "detail": f"ссылается на навык {ref}, которого нет на диске",
            })
        # Навык с disable-model-invocation вызывается только руками: его описание
        # не попадает в стартовый список и не участвует в выборе моделью. Значит
        # ни в бюджет старта, ни в коллизии активации он не входит.
        skills.append({
            "name": directory.name,
            "path": str(path),
            "description": fm.get("description", ""),
            "tokens": tokens(fm.get("description", "")),
            "model_invocable": (
                str(fm.get("disable-model-invocation", "")).lower() != "true"
                and overrides.get(directory.name) != "user-invocable-only"
            ),
        })

    routed = [s for s in skills if s["model_invocable"]]
    pairs = []
    for a, b in combinations(routed, 2):
        score = jaccard(a["tokens"], b["tokens"])
        if score >= limits["activation_overlap"]:
            shared = sorted(a["tokens"] & b["tokens"])
            pairs.append({"a": a["name"], "b": b["name"], "overlap": round(score, 3), "shared": shared})
    pairs.sort(key=lambda p: -p["overlap"])
    pairs = pairs[: int(limits["overlap_report_limit"])]
    for p in pairs:
        problems.append({
            "level": "WARN", "skill": f"{p['a']} ↔ {p['b']}", "check": "activation",
            "detail": f"описания совпадают на {p['overlap']:.0%}: {', '.join(p['shared'][:8])}",
        })

    startup_chars = sum(len(s["name"]) + len(s["description"]) for s in routed)
    startup_tokens = startup_chars // 4
    if startup_tokens > limits["startup_budget_tokens"]:
        problems.append({
            "level": "WARN", "skill": "(корпус)", "check": "startup",
            "detail": f"имена и описания ≈{startup_tokens} токенов при бюджете "
                      f"{int(limits['startup_budget_tokens'])} — грузится каждую сессию",
        })

    return {
        "skills_checked": len(skills),
        "model_invocable": len(routed),
        "startup_tokens": startup_tokens,
        "overlap_pairs": pairs,
        "problems": problems,
        "fails": sum(1 for p in problems if p["level"] == "FAIL"),
        "warns": sum(1 for p in problems if p["level"] == "WARN"),
    }


def selfcheck() -> None:
    assert parse_frontmatter("---\nname: a\ndescription: >\n  два\n  слова\n---\nтело") == {
        "name": "a", "description": "два слова"
    }
    assert parse_frontmatter('---\nname: b\ndescription: "тест"\n---\n')["description"] == "тест"
    assert parse_frontmatter("нет frontmatter") == {}
    assert tokens("Use when the user asks to deploy the app") == {"deploy", "app"}
    assert jaccard({"a", "b"}, {"a", "b"}) == 1.0
    assert jaccard({"a"}, {"b"}) == 0.0
    assert jaccard(set(), {"a"}) == 0.0
    assert MD_LINK.findall("см [x](references/y.md) и [z](https://a.b)") == ["references/y.md", "https://a.b"]
    assert strip_fences("живая [a](x.md)\n```\nшаблон [b](y.md)\n```\nхвост") == "живая [a](x.md)\nхвост"
    assert MD_LINK.findall(strip_fences("```\n[b](y.md)\n```")) == []
    assert MD_LINK.findall(INLINE_CODE.sub("", "пример `[x](url)` синтаксиса")) == []
    assert dead_skill_refs(
        "Навыки помечены `disable-model-invocation: true` — сам вызвать не могу.",
        "", "me", set(),
    ) == []
    print("corpus.py selfcheck: ok")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("roots", nargs="*", type=Path, help="каталоги со скиллами")
    parser.add_argument("--json", action="store_true", help="машинный вывод")
    parser.add_argument("--selfcheck", action="store_true", help="проверить сам скрипт")
    args = parser.parse_args()

    if args.selfcheck:
        selfcheck()
        return 0

    roots = args.roots or [Path.home() / ".claude" / "skills", Path(os.getcwd()) / ".claude" / "skills"]
    paths = discover([Path(r).expanduser() for r in roots])
    if not paths:
        print("corpus: навыков не найдено", file=sys.stderr)
        return 1

    report = analyze(paths, read_thresholds())

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2, default=list))
        return 1 if report["fails"] else 0

    for p in report["problems"]:
        print(f"{p['level']} {p['skill']} [{p['check']}] — {p['detail']}")
    print("---")
    print(f"corpus: проверено {report['skills_checked']} "
          f"(из них {report['model_invocable']} видны модели), "
          f"ошибок {report['fails']}, предупреждений {report['warns']}, "
          f"старт ≈{report['startup_tokens']} токенов")
    return 1 if report["fails"] else 0


if __name__ == "__main__":
    sys.exit(main())
