---
name: dart-lsp
description: Справка по плагину dart-lsp (языковой сервер Dart/Flutter для Claude Code). Применять, когда нужно подключить, починить или перенести LSP для .dart-файлов в проектах mobile-app.
---

# dart-lsp

Плагин версии 0.1.0 подключает языковой сервер Dart к Claude Code. Навыка в привычном смысле здесь нет: плагин состоит из двух файлов.

## Что лежит в каталоге

- `.claude-plugin/plugin.json` — манифест (имя, версия, автор).
- `.lsp.json` — запуск сервера: `dart language-server --protocol=lsp` из Dart SDK, который идёт вместе с Flutter (`/opt/homebrew/share/flutter/bin/cache/dart-sdk/bin/dart`); расширение `.dart` → язык `dart`.

## Когда применять

- LSP-запросы по `.dart`-файлам не работают или сервер не стартует.
- Flutter переехал или обновился и путь к `dart` изменился: правь только поле `command` в `.lsp.json`.

## Проверка

1. Файл по пути из `command` существует и исполняем (`ls -l <путь>`).
2. `<путь> --version` отвечает.

## Оговорка

Статус подключения не проверен: в `~/.claude/plugins/installed_plugins.json` этот плагин не значится, но подхватывает ли его Claude Code из `~/.claude/skills/` как плагин, не выяснялось.
