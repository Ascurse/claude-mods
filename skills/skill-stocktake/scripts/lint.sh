#!/usr/bin/env bash
# Механическая проверка навыков перед дорогим разбором субагентами.
# FAIL — описание сломано (нет / длиннее 1024 знаков / пересказывает шаги / прячет модель).
# WARN — SKILL.md крупнее порога: сигнал посмотреть, не блокирующая ошибка.
# Источник идеи: bigpowers (check-skill-size.sh + validate-skill-description.sh), MIT.
set -uo pipefail

MAX_DESC=1024

# Порог живёт в thresholds.yaml (skills.lint_warn_lines), как и остальные числа.
# Приоритет: переменная окружения → yaml → значение по умолчанию.
read_threshold() {
  local file="$HOME/.claude/thresholds.yaml"
  [[ -f "$file" ]] || return
  awk '
    /^skills:[[:space:]]*$/ { in_section = 1; next }
    in_section && /^[^[:space:]#]/ { exit }
    in_section && /^[[:space:]]+lint_warn_lines:/ { gsub(/[^0-9]/, ""); print; exit }
  ' "$file"
}
WARN_LINES=${SKILL_LINT_WARN_LINES:-$(read_threshold)}
WARN_LINES=${WARN_LINES:-300}
errors=0
warnings=0

# Значение description из frontmatter, включая блочную форму (`>` / `|`).
read_description() {
  awk '
    BEGIN { fence = 0; block = 0 }
    /^---[[:space:]]*$/ { fence++; if (fence >= 2) exit; next }
    fence != 1 { next }
    block {
      if ($0 ~ /^[[:space:]]+[^[:space:]]/) { sub(/^[[:space:]]+/, ""); printf "%s ", $0; next }
      exit
    }
    /^description:[[:space:]]*/ {
      sub(/^description:[[:space:]]*/, "")
      # Пустое значение или маркер блока — текст продолжается на следующих строках с отступом.
      if ($0 == "" || $0 == ">" || $0 == "|" || $0 == ">-" || $0 == "|-") { block = 1; next }
      gsub(/^"|"$/, "")
      printf "%s", $0
      exit
    }
  ' "$1"
}

lint_skill() {
  local path="$1" name desc len
  name="$(basename "$(dirname "$path")")"
  desc="$(read_description "$path")"

  if [[ -z "$desc" ]]; then
    echo "FAIL $name — во frontmatter нет description"
    errors=$((errors + 1))
    return
  fi

  len=${#desc}
  if (( len > MAX_DESC )); then
    echo "FAIL $name — description $len знаков (предел $MAX_DESC)"
    errors=$((errors + 1))
  fi

  # Описание нужно для выбора навыка — там место поводам вызова, а не пересказу шагов.
  # Цепочка «Covers: a → b → c» здесь принята сознательно и нарушением не считается.
  if grep -qE '(^|[[:space:]])([0-9]+\.[[:space:]]|Step [0-9]+|Шаг [0-9]+|Process:|Workflow:|HARD GATE)' <<<"$desc"; then
    echo "FAIL $name — description пересказывает порядок шагов (оставить поводы вызова, шаги — в тело)"
    errors=$((errors + 1))
  fi

  if grep -qE 'model:[[:space:]]*(haiku|sonnet|opus|fable)' <<<"$desc"; then
    echo "FAIL $name — подсказка модели должна быть отдельным полем frontmatter, не внутри description"
    errors=$((errors + 1))
  fi

  local lines
  lines=$(wc -l < "$path" | tr -d ' ')
  if (( lines > WARN_LINES )); then
    echo "WARN $name — SKILL.md $lines строк (порог $WARN_LINES)"
    warnings=$((warnings + 1))
  fi
}

files=()
if (( $# > 0 )); then
  files=("$@")
else
  seen_roots=""
  for root in "$HOME/.claude/skills" "$PWD/.claude/skills"; do
    [[ -d "$root" ]] || continue
    # $PWD может совпасть с $HOME — не сканировать один каталог дважды
    real="$(cd "$root" && pwd -P)"
    case " $seen_roots " in *" $real "*) continue ;; esac
    seen_roots="$seen_roots $real"
    while IFS= read -r f; do files+=("$f"); done \
      < <(find -L "$root" -maxdepth 2 -name SKILL.md | sort)
  done
fi

if (( ${#files[@]} == 0 )); then
  echo "skill-lint: навыков не найдено" >&2
  exit 1
fi

for f in "${files[@]}"; do
  [[ -f "$f" ]] || { echo "FAIL — файла нет: $f"; errors=$((errors + 1)); continue; }
  lint_skill "$f"
done

echo "---"
echo "skill-lint: проверено ${#files[@]}, ошибок $errors, предупреждений $warnings"
(( errors == 0 ))
