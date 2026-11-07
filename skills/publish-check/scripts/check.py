#!/usr/bin/env python3
"""Проверка файлов на утечку рабочего перед публикацией: стоп-лист + NDA-вопросы Jev.

Вопросы, стоп-лист и вызов Jev живут в jev_shadow.py, здесь только обход файлов.
Код возврата: 0 чисто, 1 есть сигнал, 2 проверка не состоялась.
"""
import pathlib
import re
import sys

LINT_DIR = pathlib.Path.home() / ("Documents/ObsidianSecondBrain/Projects/personal-brand/"
                                  "Process/decision-graph-lint")
sys.path.insert(0, str(LINT_DIR))

from jev_shadow import NDA_QUESTIONS, call, load_key, load_watchlist, watchlist_hits  # noqa: E402

CHUNK_CHARS = 12000  # длинный текст режем: одна деталь иначе теряется в общей оценке
LEAK_THRESHOLD = 0.5  # тот же порог, что у теневого слоя


def visible_text(path: pathlib.Path) -> str:
    text = path.read_text(encoding="utf-8")
    if path.suffix in {".html", ".astro"}:
        text = re.sub(r"<(script|style)\b.*?</\1>", " ", text, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", " ", text)
    return text


def chunks(text: str):
    """Кусками по абзацам; отдаёт (номер первой строки, текст)."""
    buf, size, start, line = [], 0, 1, 1
    for para in re.split(r"(?<=\n)\s*\n", text):
        if buf and size + len(para) > CHUNK_CHARS:
            yield start, "\n".join(buf)
            buf, size, start = [], 0, line
        buf.append(para)
        size += len(para)
        line += para.count("\n") + 1
    if buf:
        yield start, "\n".join(buf)


def check(path: pathlib.Path, key: str) -> bool:
    text = visible_text(path)
    flagged = False
    hits = watchlist_hits(text)
    if hits:
        flagged = True
        print(f"{path}: стоп-лист: " + ", ".join(f"{t}×{n}" for t, n in hits.items()))
    for line, part in chunks(text):
        answers = call(key, part, NDA_QUESTIONS)[0]["answers"]
        leak = answers["work_leak"]["noul"]
        context = answers["work_context"]["noul"]
        if leak >= LEAK_THRESHOLD or context >= LEAK_THRESHOLD:
            flagged = True
            print(f"{path}: от строки {line}: leak {leak:.2f}, context {context:.2f}")
    return flagged


def main() -> int:
    paths = [pathlib.Path(a) for a in sys.argv[1:]]
    if not paths:
        print("usage: check.py FILE...", file=sys.stderr)
        return 2
    if not load_watchlist():
        print("стоп-лист пуст, проверяет только Jev", file=sys.stderr)
    key = load_key()
    flagged = failed = 0
    for path in paths:
        try:
            flagged += check(path, key)
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"{path}: НЕ ПРОВЕРЕН: {e}", file=sys.stderr)
    print(f"файлов {len(paths)}, с сигналом {flagged}, не проверено {failed}")
    return 2 if failed else 1 if flagged else 0


if __name__ == "__main__":
    sys.exit(main())
