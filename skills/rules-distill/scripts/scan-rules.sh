#!/usr/bin/env bash
# scan-rules.sh — enumerate rule files and extract H2 heading index
# Usage: scan-rules.sh [RULES_DIR]
# Output: JSON to stdout
#
# With no argument, the rules directory is auto-discovered in this order:
#   1. $PWD/.claude/rules            (project rules — the common case)
#   2. <git toplevel>/.claude/rules  (invoked from a subdirectory)
#   3. ~/.claude/rules               (global rules, if the user keeps any)
# The first one that exists wins; the rest are reported in "searched".
#
# Environment:
#   RULES_DISTILL_DIR  Force a specific rules directory (overrides everything)

set -euo pipefail

candidates=()
if [[ -n "${RULES_DISTILL_DIR:-}" ]]; then
  candidates=("$RULES_DISTILL_DIR")
elif [[ -n "${1:-}" ]]; then
  candidates=("$1")
else
  candidates=("$PWD/.claude/rules")
  git_root=$(git rev-parse --show-toplevel 2>/dev/null || true)
  [[ -n "$git_root" ]] && candidates+=("$git_root/.claude/rules")
  candidates+=("$HOME/.claude/rules")
fi

RULES_DIR=""
for c in "${candidates[@]}"; do
  if [[ -d "$c" ]]; then
    RULES_DIR="$c"
    break
  fi
done

if [[ -z "$RULES_DIR" ]]; then
  jq -n --argjson searched "$(printf '%s\n' "${candidates[@]}" | jq -R . | jq -s '.')" \
    '{"error":"rules directory not found","searched":$searched}' >&2
  exit 1
fi

# Global instruction files live outside any rules dir but are part of the rules
# corpus — a distillation pass that ignores them proposes duplicates.
global_files=()
for g in "$HOME/.claude/CLAUDE.md" "$HOME/.claude/frontend-rules.md" "$HOME/.claude/zigmund-rules.md"; do
  [[ -f "$g" ]] && global_files+=("~/${g#"$HOME"/}")
done
if [[ ${#global_files[@]} -eq 0 ]]; then
  globals_json='[]'
else
  globals_json=$(printf '%s\n' "${global_files[@]}" | jq -R . | jq -s '.')
fi

# Collect all .md files (excluding _archived/)
files=()
while IFS= read -r f; do
  files+=("$f")
done < <(find "$RULES_DIR" -name '*.md' -not -path '*/_archived/*' -print | sort)

total=${#files[@]}

tmpdir=$(mktemp -d)
_rules_cleanup() { rm -rf "$tmpdir"; }
trap _rules_cleanup EXIT

for i in "${!files[@]}"; do
  file="${files[$i]}"
  rel_path="${file#"$HOME"/}"
  rel_path="~/$rel_path"

  # Extract H2 headings (## Title) into a JSON array via jq
  headings_json=$({ grep -E '^## ' "$file" 2>/dev/null || true; } | sed 's/^## //' | jq -R . | jq -s '.')

  # Get line count
  line_count=$(wc -l < "$file" | tr -d ' ')

  jq -n \
    --arg path "$rel_path" \
    --arg file "$(basename "$file")" \
    --argjson lines "$line_count" \
    --argjson headings "$headings_json" \
    '{path:$path,file:$file,lines:$lines,headings:$headings}' \
    > "$tmpdir/$i.json"
done

if [[ ${#files[@]} -eq 0 ]]; then
  jq -n --arg dir "$RULES_DIR" --argjson globals "$globals_json" \
    '{rules_dir:$dir,total:0,rules:[],global_instruction_files:$globals}'
else
  jq -n \
    --arg dir "$RULES_DIR" \
    --argjson total "$total" \
    --argjson rules "$(jq -s '.' "$tmpdir"/*.json)" \
    --argjson globals "$globals_json" \
    '{rules_dir:$dir,total:$total,rules:$rules,global_instruction_files:$globals}'
fi
