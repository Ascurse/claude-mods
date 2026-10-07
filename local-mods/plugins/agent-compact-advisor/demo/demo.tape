# Records demo/demo.gif: `vhs demo/demo.tape` from the repository root.
# Needs Claude Code 2.1.287+ with agent-compact-advisor 0.2.0 and
# agent-shell-watch installed from the agent-mods marketplace (shell-watch
# reports background calls; without it the score is capped at 60). Runs in a
# throwaway project at /tmp/demo-cca (four generated log files) without user
# settings (no personal hooks, status line or other mods) or personal
# instructions (agents-md managed-only). Every threshold is the default
# (minTokens 100k, alertPercent 60); only Kev's P1 is off, the leftover lines
# read as "Leftovers:" and the words are English. Haiku, four real calls: a
# small turn, a turn that reads the logs (about 126k tokens, 63% of the
# window), a small follow-up and the /compact the advisor suggests.
#
# Not shown: ignoreLeftovers (coordinator sessions whose leftovers always say
# "wait for the others"; set it in /config).

Output demo/demo.gif

Require claude

Set Shell "zsh"
Set FontSize 14
Set Width 1440
Set Height 740
Set Padding 16
Set Theme "Catppuccin Mocha"
Set TypingSpeed 20ms
Set Framerate 15

Hide
Type `unset CLAUDE_CODE_CHILD_SESSION CLAUDECODE; rm -rf /tmp/demo-cca; mkdir -p /tmp/demo-cca/logs; cd /tmp/demo-cca; for i in 1 2 3 4; do awk -v s=$i 'BEGIN{srand(s);for(n=0;n<700;n++)printf "2026-10-05T12:%02d:%02d worker-%d INFO job=%d done in %dms sha=%x%x\n",n/60%60,n%60,int(rand()*8),int(rand()*99999),int(rand()*900),int(rand()*1e9),int(rand()*1e9)}' > logs/w$i.log; done; clear`
Enter
Type `claude --model haiku --setting-sources project,local --settings '{"enabledPlugins":{"agent-compact-advisor@agent-mods":true,"agent-shell-watch@agent-mods":true},"permissions":{"allow":["Read"]},"pluginConfigs":{"agents-md@builtin":{"options":{"instructionFiles":"managed-only"}},"agent-compact-advisor@agent-mods":{"options":{"systemOneUrl":"","leftoverPrefixes":"Leftovers:","language":"en"}}}}'`
Enter
Sleep 8s
# Clears the launch command off the screen.
Ctrl+L
Sleep 1s
Show

# 1. A small turn: the status line says, in words, why not yet.
Type "Reply: OK, ready. Then a new line: Leftovers: none"
Sleep 400ms
Enter
Hide
Wait+Screen@60s /too early: context is small/
Show
Sleep 3s

# 2. A turn that reads a lot: past 60% of the window the line alerts.
Type "Read every file in logs/. Reply with the file count, then a new line: Leftovers: none"
Sleep 400ms
Enter
Hide
Wait+Screen@120s /time to compact/
Show
Sleep 4s

# The ready /compact is offered at a turn's end; the context reading can land
# just after the read turn's end, so one more small turn makes it certain.
Type "Thanks. Reply: OK. Then a new line: Leftovers: none"
Sleep 400ms
Enter
Hide
Wait+Screen@60s /Keep the goal/
Show
Sleep 4s

# 3. The score alone says "can wait", yet the alert put the ready /compact in
# the empty box: Tab takes it, Enter runs it; the status line resets.
Tab
Sleep 2s
Enter
Hide
Wait+Screen@120s /Compacted/
Show
Sleep 6s
