# Security policy

## Supported versions

Only the latest release of agent-compact-advisor is supported.

## Reporting a vulnerability

Please report privately through
[GitHub Security Advisories](https://github.com/apolenkov/agent-compact-advisor/security/advisories/new).
Do not open a public issue. You will get an answer within 7 days.

## What agent-compact-advisor does on your machine

It reads the session's context size, its running agents, agent-shell-watch's
call list when that mod is loaded, and the last answer of each main turn. It
never compacts by itself and never cancels a compaction; it adds a fixed
preservation template to the instructions of `/compact` and auto-compaction.

One network call: the last answer's final 8000 characters are posted to Kev's
System One endpoint (`systemOneUrl`, default `http://127.0.0.1:8010`) for the
P1 signal. Only a loopback host is accepted; any other URL, or an empty one,
turns P1 off and nothing is sent. Whatever listens on that loopback port
receives the text and is trusted with it: the host's fetch follows redirects,
so such a service could pass it on, as it could by any other means. No key, no
telemetry, nothing stored across sessions.
