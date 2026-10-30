Проверено: 2026-08-25, ecc-agentshield 1.4.0 (`npm view ecc-agentshield version`)

# AgentShield CLI — справочник флагов и форматов

## Prerequisites

AgentShield must be installed. Check and install if needed:

```bash
# Check if installed
yarn dlx ecc-agentshield --version

# Install globally (recommended)
yarn global add ecc-agentshield

# Or run directly via yarn dlx (no install needed)
yarn dlx ecc-agentshield scan .
```

## Basic Scan

```bash
# Scan current project
yarn dlx ecc-agentshield scan

# Scan a specific path
yarn dlx ecc-agentshield scan --path /path/to/.claude

# Scan with minimum severity filter
yarn dlx ecc-agentshield scan --min-severity medium
```

## Output Formats

```bash
# Terminal output (default) — colored report with grade
yarn dlx ecc-agentshield scan

# JSON — for CI/CD integration
yarn dlx ecc-agentshield scan --format json

# Markdown — for documentation
yarn dlx ecc-agentshield scan --format markdown

# HTML — self-contained dark-theme report
yarn dlx ecc-agentshield scan --format html > security-report.html
```

## Auto-Fix

Apply safe fixes automatically (only fixes marked as auto-fixable):

```bash
yarn dlx ecc-agentshield scan --fix
```

This will:
- Replace hardcoded secrets with environment variable references
- Tighten wildcard permissions to scoped alternatives
- Never modify manual-only suggestions

## Deep Analysis (adversarial pipeline)

Run the adversarial three-agent pipeline for deeper analysis:

```bash
# Requires ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY=your-key
yarn dlx ecc-agentshield scan --opus --stream
```

This runs:
1. **Attacker (Red Team)** — finds attack vectors
2. **Defender (Blue Team)** — recommends hardening
3. **Auditor (Final Verdict)** — synthesizes both perspectives

## Initialize Secure Config

Scaffold a new secure `.claude/` configuration from scratch:

```bash
yarn dlx ecc-agentshield init
```

Creates:
- `settings.json` with scoped permissions and deny list
- `CLAUDE.md` with security best practices
- `mcp.json` placeholder

## GitHub Action

Add to your CI pipeline:

```yaml
- uses: affaan-m/agentshield@v1
  with:
    path: '.'
    min-severity: 'medium'
    fail-on-findings: true
```

## Severity Levels

| Grade | Score | Meaning |
|-------|-------|---------|
| A | 90-100 | Secure configuration |
| B | 75-89 | Minor issues |
| C | 60-74 | Needs attention |
| D | 40-59 | Significant risks |
| F | 0-39 | Critical vulnerabilities |

## Interpreting Results

### Critical Findings (fix immediately)
- Hardcoded API keys or tokens in config files
- `Bash(*)` in the allow list (unrestricted shell access)
- Command injection in hooks via `${file}` interpolation
- Shell-running MCP servers

### High Findings (fix before production)
- Auto-run instructions in CLAUDE.md (prompt injection vector)
- Missing deny lists in permissions
- Agents with unnecessary Bash access

### Medium Findings (recommended)
- Silent error suppression in hooks (`2>/dev/null`, `|| true`)
- Missing PreToolUse security hooks
- `npx -y` auto-install in MCP server configs

### Info Findings (awareness)
- Missing descriptions on MCP servers
- Prohibitive instructions correctly flagged as good practice

## Links

- **GitHub**: [github.com/affaan-m/agentshield](https://github.com/affaan-m/agentshield)
- **npm**: [npmjs.com/package/ecc-agentshield](https://www.npmjs.com/package/ecc-agentshield)
