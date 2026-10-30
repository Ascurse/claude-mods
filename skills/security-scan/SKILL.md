---
name: security-scan
description: Scan your Claude Code configuration (.claude/ directory) for security vulnerabilities, misconfigurations, and injection risks using AgentShield. Checks CLAUDE.md, settings.json, MCP servers, hooks, and agent definitions.
metadata:
  origin: ECC
---

# Security Scan Skill

Audit your Claude Code configuration for security issues using [AgentShield](https://github.com/affaan-m/agentshield).

## When to Activate

- Setting up a new Claude Code project
- After modifying `.claude/settings.json`, `CLAUDE.md`, or MCP configs
- Before committing configuration changes
- When onboarding to a new repository with existing Claude Code configs
- Periodic security hygiene checks

## What It Scans

| File | Checks |
|------|--------|
| `CLAUDE.md` | Hardcoded secrets, auto-run instructions, prompt injection patterns |
| `settings.json` | Overly permissive allow lists, missing deny lists, dangerous bypass flags |
| `mcp.json` | Risky MCP servers, hardcoded env secrets, npx supply chain risks |
| `hooks/` | Command injection via interpolation, data exfiltration, silent error suppression |
| `agents/*.md` | Unrestricted tool access, prompt injection surface, missing model specs |

## Basic Usage

```bash
# Scan current project's .claude/ directory (downloads via yarn dlx if needed)
yarn dlx ecc-agentshield scan
```

For the full flag/format reference — path scoping, severity filters, output formats, `--fix`, deep analysis (`--opus`), `init`, GitHub Action, severity grades, and how to interpret findings — see `references/agentshield-cli.md`.

### Deep Analysis (Opus)

For a deeper adversarial three-agent review (attacker/defender/auditor), see the `--opus --stream` invocation in `references/agentshield-cli.md`.

## Links

- **GitHub**: [github.com/affaan-m/agentshield](https://github.com/affaan-m/agentshield)
- **npm**: [npmjs.com/package/ecc-agentshield](https://www.npmjs.com/package/ecc-agentshield)
