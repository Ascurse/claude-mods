#!/bin/sh
# Live smoke of what a headless run cannot show: a real interactive session in
# tmux, checked on the captured screen: after a first turn the status line
# carries the advisor's verdict in words. Needs tmux and a Claude login; costs
# a cent (haiku, one small turn). Run: npm run smoke:live
set -eu
repo=$(cd "$(dirname "$0")/.." && pwd)
session=ccasmoke$$
project=/tmp/cca-smoke
home=/tmp/cca-smoke-home

screen() { tmux capture-pane -t "$session" -p -J; }

# wait_for <pattern> <seconds>: poll the screen until the pattern shows.
wait_for() {
  i=0
  while [ "$i" -lt "$2" ]; do
    screen | grep -q -- "$1" && return 0
    sleep 1
    i=$((i + 1))
  done
  echo "FAIL: '$1' did not show in $2 s. Screen:" >&2
  screen >&2
  exit 1
}

cleanup() {
  tmux kill-session -t "$session" 2>/dev/null || true
  rm -rf "$project" "$home"
}
trap cleanup EXIT

# A throwaway project and HOME; the only link to the real home is the login
# keychain, so the session can reach Claude.
rm -rf "$project" "$home"
mkdir -p "$project" "$home/Library"
ln -s "$HOME/Library/Keychains" "$home/Library/Keychains"
printf '%s\n' "{\"hasCompletedOnboarding\":true,\"theme\":\"dark\",\"projects\":{\"$project\":{\"hasTrustDialogAccepted\":true},\"/private$project\":{\"hasTrustDialogAccepted\":true}}}" > "$home/.claude.json"

tmux new-session -d -s "$session" -x 150 -y 45 \
  "unset CLAUDE_CODE_CHILD_SESSION CLAUDECODE; export HOME=$home; cd $project; claude --model haiku --plugin-dir '$repo' --setting-sources project,local --settings '{\"pluginConfigs\":{\"agents-md@builtin\":{\"options\":{\"instructionFiles\":\"managed-only\"}},\"agent-compact-advisor@inline\":{\"options\":{\"language\":\"en\"}}}}'"

wait_for '❯' 60
tmux send-keys -t "$session" "Reply: OK, ready. Then a new line: Leftovers: none"
sleep 1
tmux send-keys -t "$session" C-m
wait_for 'too early: context is small' 120
echo "ok: the status line carries the advisor's verdict after a turn"
