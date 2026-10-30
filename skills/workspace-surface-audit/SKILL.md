---
name: workspace-surface-audit
description: Audits the active repo, MCP servers, plugins, connectors, and harness setup against your ~/.claude inventory, then recommends high-value skills and workflows.
disable-model-invocation: true
---

# Workspace Surface Audit

Read-only audit skill for answering the question "what can this workspace and machine actually do right now, and what should we add or enable next?"

It benchmarks against the user's real, currently installed setup — not an external catalog. It does not modify files unless the user explicitly asks for follow-up implementation.

## When to Use

- User says "set up Claude Code", "recommend automations", "what plugins or MCPs should I use?", or "what am I missing?"
- Auditing a machine or repo before installing more skills, hooks, or connectors
- Checking official marketplace plugins against what is already installed
- Reviewing `.env`, `.mcp.json`, plugin settings, or connected-app surfaces to find missing workflow layers
- Deciding whether a capability should be a skill, hook, agent, MCP, or external connector

## Non-Negotiable Rules

- Never print secret values. Surface only provider names, capability names, file paths, and whether a key or config exists.
- Prefer wiring up what is already installed (`~/.claude/skills`, `~/.claude/agents`, enabled plugins, configured MCP servers) over generic "install another plugin" advice when the existing setup can reasonably own the surface.
- Treat external plugins and marketplace listings as benchmarks and inspiration, not authoritative product boundaries.
- Separate three things clearly:
  - already available now
  - available but not wrapped well in the current setup
  - not available and would require a new integration

## Audit Inputs

Inspect only the files and settings needed to answer the question well:

1. Repo surface
   - `package.json`, lockfiles, language markers, framework config, `README.md`
   - `.mcp.json`, `.lsp.json`, `.claude/settings*.json`, `.codex/*`
   - `AGENTS.md`, `CLAUDE.md`, install manifests, hook configs
2. Environment surface
   - `.env*` files in the active repo and obvious adjacent workspaces
   - Surface only key names such as `STRIPE_API_KEY`, `TWILIO_AUTH_TOKEN`, `FAL_KEY`
3. Connected tool surface
   - Installed plugins, enabled connectors, MCP servers, LSPs, and app integrations
4. Current setup surface
   - Existing skills, agents, hooks, and permissions in `~/.claude` that already cover the need

## Audit Process

### Phase 1: Inventory What Exists

Enumerate the real, current inventory with concrete commands rather than guessing:

- installed skills: `ls ~/.claude/skills` (plus `.claude/skills` in the active repo, if any)
- installed agents: `ls ~/.claude/agents`
- hooks configured: `jq '.hooks | keys' ~/.claude/settings.json` (and `~/.claude/settings.local.json`, and repo-level `.claude/settings.json`)
- permissions: `jq '.permissions' ~/.claude/settings.json`
- configured MCP servers: `jq '.mcpServers' ~/.claude/settings.json` and `.mcp.json` in the active repo
- installed/enabled plugins: `claude plugin list --json` (add `--available` to also see what marketplaces offer but the user hasn't installed)
- env-backed services implied by key names in `.env*`

Produce a compact inventory from these outputs:

- active harness targets
- installed plugins and connected apps
- configured MCP servers
- configured LSP servers
- env-backed services implied by key names
- existing skills/agents/hooks already relevant to the workspace

If a surface exists only as a primitive, call that out. Example:

- "Stripe is available via connected app, but there is no billing-operator skill for it"
- "Google Drive is connected, but there is no Google Workspace operator workflow wrapping it"

### Phase 2: Benchmark Against the Actual Setup

Compare what the task needs against the Phase 1 inventory:

- official Claude plugins that overlap with setup, review, docs, design, or workflow quality — checked against `claude plugin list --available --json`, not assumed
- what is already installed (skills, agents, hooks, MCP servers) per the enumeration above
- the user's currently connected app surfaces

Do not just list names. For each comparison, answer:

1. what they actually do
2. is it already installed and wired up (present in the inventory and actually referenced by config/hooks)
3. is it installed but unused (present in the inventory, nothing triggers or calls it)
4. is it missing entirely (not in the inventory)

### Phase 3: Turn Gaps Into Decisions

For every real gap, recommend the correct shape:

| Gap Type | Preferred Shape |
|----------|---------------------|
| Repeatable operator workflow | Skill |
| Automatic enforcement or side-effect | Hook |
| Specialized delegated role | Agent |
| External tool bridge | MCP server or connector |
| Install/bootstrap guidance | Setup or audit skill |

Default to user-facing skills that orchestrate existing tools when the need is operational rather than infrastructural. If the right shape is a brand-new skill the user doesn't have, invoke the `skill-scout` skill to search local, marketplace, GitHub, and web sources before proposing one from scratch.

## Output Format

Return five sections in this order:

1. **Current surface**
   - what is already usable right now (from the Phase 1 inventory)
2. **Installed and wired up**
   - where the current setup already has this covered
3. **Installed but unused**
   - tools/skills/agents exist in the inventory, but nothing wraps or triggers them for this need
4. **Missing integrations**
   - capability not available yet
5. **Top 3-5 next moves**
   - concrete additions, ordered by impact

## Recommendation Rules

- Recommend at most 1-2 highest-value ideas per category.
- Favor skills with obvious user intent and business value:
  - setup audit
  - billing/customer ops
  - issue/program ops
  - Google Workspace ops
  - deployment/ops control
- If a connector is company-specific, recommend it only when it is genuinely available or clearly useful to the user's workflow.
- If the current setup already has a strong primitive, propose a wrapper skill instead of inventing a brand-new subsystem.
- For any genuinely new skill, run it through `skill-scout` first rather than assuming none exists.

## Good Outcomes

- The user can immediately see what is connected, what is missing, and what the setup should own next.
- Recommendations are specific enough to implement in the repo without another discovery pass.
- The final answer is organized around workflows, not API brands.
