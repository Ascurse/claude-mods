#!/usr/bin/env python3
"""Делает HTML самодостаточным: подменяет ссылки на картинки их содержимым.

Запуск:  python встроить-картинки.py путь/к/баглист.html
Проверка: python встроить-картинки.py --самопроверка

Картинки ужимаются до 1280 точек по ширине (ffmpeg) — читать текст ошибки хватает,
а страница остаётся такой, чтобы уходила мессенджером. Полноразмерные файлы
остаются в папке нетронутыми: они идут вложениями в трекер.
"""
import base64
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ШИРИНА = 1280
ПРЕДЕЛ_МБ = 10
ССЫЛКА = re.compile(r'src="(?!data:)([^"]+)"')


def ужать(файл: Path) -> bytes:
    """Уменьшить картинку до ШИРИНА по ширине. Ошибка ffmpeg — берём как есть."""
    with tempfile.TemporaryDirectory() as tmp:
        цель = Path(tmp) / "кадр.jpg"
        итог = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(файл),
             "-vf", f"scale='min({ШИРИНА},iw)':-2", "-q:v", "4", str(цель)],
            capture_output=True,
        )
        if итог.returncode == 0 and цель.exists():
            return цель.read_bytes()
        print(f"[встроить] ffmpeg не ужал {файл.name}, вшиваю как есть", file=sys.stderr)
        return файл.read_bytes()


def встроить(html: Path) -> int:
    папка = html.parent
    текст = html.read_text(encoding="utf-8")
    встроено = 0

    def замена(m):
        nonlocal встроено
        картинка = папка / m.group(1)
        if not картинка.exists():
            raise SystemExit(f"ОШИБКА: нет файла {картинка} — страница не будет самодостаточной")
        данные = base64.b64encode(ужать(картинка)).decode("ascii")
        встроено += 1
        return f'src="data:image/jpeg;base64,{данные}"'

    html.write_text(ССЫЛКА.sub(замена, текст), encoding="utf-8")

    размер = html.stat().st_size / 1024 / 1024
    print(f"[встроить] вшито картинок: {встроено}; размер страницы: {размер:.1f} МБ")
    if размер > ПРЕДЕЛ_МБ:
        print(f"[встроить] ВНИМАНИЕ: больше {ПРЕДЕЛ_МБ} МБ — мессенджер может не принять", file=sys.stderr)
    return встроено


def самопроверка():
    """Собирает страницу с настоящей картинкой и проверяет, что внешних ссылок не осталось."""
    with tempfile.TemporaryDirectory() as tmp:
        папка = Path(tmp)
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi",
             "-i", "color=c=red:s=1920x1080:d=1", "-frames:v", "1", str(папка / "кадр.jpg")],
            check=True,
        )
        стр = папка / "страница.html"
        стр.write_text('<img src="кадр.jpg">', encoding="utf-8")

        assert встроить(стр) == 1, "картинка не вшилась"
        итог = стр.read_text(encoding="utf-8")
        assert 'src="data:image/jpeg;base64,' in итог, "нет вшитых данных"
        assert not ССЫЛКА.search(итог), "осталась внешняя ссылка на картинку"

        # Отсутствующий файл обязан ронять сборку, а не молча оставлять ссылку.
        битая = папка / "битая.html"
        битая.write_text('<img src="нет-такого.jpg">', encoding="utf-8")
        try:
            встроить(битая)
        except SystemExit:
            pass
        else:
            raise AssertionError("пропущенная картинка не уронила сборку")
    print("[встроить] самопроверка пройдена")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    if sys.argv[1] == "--самопроверка":
        самопроверка()
    else:
        встроить(Path(sys.argv[1]))
