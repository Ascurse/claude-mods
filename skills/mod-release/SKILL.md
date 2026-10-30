---
name: mod-release
description: Выпуск правки локального мода из ~/.claude/local-mods так, чтобы Claude Code загрузил новую версию, а не старую копию из кэша. Use after changing a mod in ~/.claude/local-mods/plugins/<mod> (bead-band, next-steps, agent-flow, agent-compact-advisor, flightdeck, crew) and before saying the change works. Triggers — «выпусти мод», «подними версию мода», «правка мода не применилась», «мод работает по-старому».
---

# Выпуск локального мода

Claude Code грузит мод не из исходников `~/.claude/local-mods/plugins/<мод>/`, а из кэша
`~/.claude/plugins/cache/local-mods/<мод>/<версия>/`. `claude plugin test .` проверяет исходники и
бывает зелёным, хотя живой мод остался старым. `/reload-plugins` кэш не обновляет. Без подъёма
версии правка «не работает» — 07.10.2026 так потеряли две попытки подряд.

Коммит, слияние ветки бида и закрытие — по навыку `beads-workflow` (трекер `~/.claude/.beads`,
`bd` запускать из `~/.claude`). Здесь только то, что идёт после зелёных тестов.

## Шаги

1. **Тесты по исходникам:** `claude plugin test ~/.claude/local-mods/plugins/<мод>`.
2. **Поднять `version`** в `~/.claude/local-mods/plugins/<мод>/.claude-plugin/plugin.json`
   (исправление — третья цифра, новая возможность — вторая). В `marketplace.json` версий нет,
   его не трогать. Подъём версии — в коммите правки или отдельным коммитом вида `crew: 0.3.1`.
3. **Обновить каталог и мод:**
   ```bash
   claude plugin marketplace update local-mods
   ```
   ```bash
   claude plugin update <мод>@local-mods
   ```
4. **Проверить, что встала новая копия:** в `~/.claude/plugins/installed_plugins.json` у записи
   `<мод>@local-mods` поля `version` и `installPath` должны указывать на новую версию
   (`grep -n -A3 '<мод>@local-mods' ~/.claude/plugins/installed_plugins.json`).
5. **Перезапуск сессии** — это делает пользователь. Не пиши «работает», пока он не подтвердил
   поведение в новой сессии; до этого — «выпущено, ждёт проверки после перезапуска».

## Ловушки

- Совпадение версии в `installed_plugins.json` со старой — значит, шаг 2 забыт или
  `marketplace update` не прошёл; `plugin update` без нового номера ничего не делает.
- `claude plugin disable/enable` пишет в выводе `(scope: project)`, а правит глобальный
  `~/.claude/settings.json` — проверять diff файла, а не сообщение.
- Внешний вид мода (полоса над полем ввода, панель) — навык `mod-builder`; этот навык только
  про доставку правки.
