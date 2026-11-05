#!/usr/bin/env python3
"""Бесплатный сборщик hygiene-sweep: цена старта, использование, кандидаты, дельта.

Только stdlib, без вызовов модели. Конфиг не меняет: пишет отчёт в ~/.claude/audits,
а с --log ещё строку в context-budget-log.tsv.
"""
import argparse
import concurrent.futures as futures
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DEFAULTS = {
    "usage_window_days": 30,
    "history_days": 90,
    "low_use_calls": 3,
    "low_use_min_startup_tokens": 500,
    "skill_candidate_min_tokens": 80,
    "plugin_idle_days": 30,
    "delta_flag_pct": 10,
    "delta_flag_min_tokens": 500,
    "setup_audit_every_days": 30,
    "plugin_details_workers": 4,
}
CHARS_PER_TOKEN = 4
COMMAND_TIMEOUT_SECONDS = 90
STARTUP_LINES_TO_READ = 120


def claude_bin():
    return shutil.which("claude") or str(Path.home() / ".local/bin/claude")


def run(cmd, timeout=COMMAND_TIMEOUT_SECONDS, cwd=None):
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=cwd,
                          stdin=subprocess.DEVNULL)
    return proc.returncode, proc.stdout, proc.stderr


def checked(cmd, **kw):
    code, out, err = run(cmd, **kw)
    if code != 0:
        raise RuntimeError(f"код {code}: {(err or out).strip()[:200]}")
    return out


def tokens_from_chars(chars):
    return round(chars / CHARS_PER_TOKEN)


def parse_tokens(text):
    text = str(text).strip().lstrip("~").replace(",", "")
    if text in ("", "-", "—"):
        return 0
    match = re.fullmatch(r"([\d.]+)\s*([kKmM]?)", text)
    if not match:
        return 0
    return round(float(match[1]) * {"": 1, "k": 1e3, "m": 1e6}[match[2].lower()])


def normalize(name):
    return re.sub(r"[^a-zA-Z0-9]+", "_", name).strip("_").lower()


def read_thresholds(path):
    """Секция hygiene: в thresholds.yaml; плоские ключи, PyYAML не нужен."""
    values, inside = dict(DEFAULTS), False
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return values
    for line in lines:
        if re.match(r"^hygiene:\s*$", line):
            inside = True
        elif inside and re.match(r"^\S", line) and not line.startswith("#"):
            break
        elif inside:
            match = re.match(r"^\s+(\w+):\s*(\d+)", line)
            if match and match[1] in values:
                values[match[1]] = int(match[2])
    return values


# --- разбор вывода встроенных команд ---

def parse_markdown_tables(text):
    sections, title, header = {}, None, None
    for line in text.splitlines():
        if line.startswith("### "):
            title, header = line[4:].strip(), None
            sections[title] = []
        elif title and line.startswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if header is None:
                header = cells
            elif not set("".join(cells)) <= set("-: "):
                sections[title].append(dict(zip(header, cells)))
    return sections


def parse_context(text):
    tables = parse_markdown_tables(text)
    categories = {r["Category"]: parse_tokens(r["Tokens"])
                  for r in tables.get("Estimated usage by category", [])}
    if not categories:
        raise ValueError("в выводе /context нет таблицы категорий")
    servers = {}
    for row in tables.get("MCP Tools", []):
        entry = servers.setdefault(row["Server"], {"tools": [], "schema_tokens": 0})
        entry["tools"].append(row["Tool"].rsplit("__", 1)[-1])
        entry["schema_tokens"] += parse_tokens(row["Tokens"])
    total = re.search(r"\*\*Tokens:\*\*\s*([\d.]+k?)\s*/\s*([\d.]+k?)", text)
    model = re.search(r"\*\*Model:\*\*\s*(\S+)", text)
    return {
        "model": model[1] if model else "?",
        "total": parse_tokens(total[1]) if total else 0,
        "limit": parse_tokens(total[2]) if total else 0,
        "categories": categories,
        "servers": servers,
        "agents": tables.get("Custom Agents", []),
        "memory": tables.get("Memory Files", []),
        "skills": tables.get("Skills", []),
    }


SKILL_ROW = re.compile(r"^\s{2}(\S+)\s+(\S+(?: sync)?)\s+(~?[\d.,]+k?|-)\s+(~?[\d.,]+[kKmM]?|-)\s+(\d+)×\s+(.+?)\s*$")
PLUGIN_ROW = re.compile(r"^\s{2}(\S+)\s+last used (\d+) days? ago")


def parse_skill_doctor(text):
    skills, idle_plugins = [], {}
    for line in text.splitlines():
        row = SKILL_ROW.match(line)
        if row:
            skills.append({"name": row[1], "source": row[2], "context": parse_tokens(row[3]),
                           "uses": int(row[5]), "last": row[6]})
            continue
        row = PLUGIN_ROW.match(line)
        if row:
            idle_plugins[row[1]] = int(row[2])
    if not skills:
        raise ValueError("в выводе /skill-doctor нет таблицы скиллов")
    return {"skills": skills, "idle_plugins": idle_plugins}


def parse_mcp_list(text):
    servers = {}
    for line in text.splitlines():
        match = re.match(r"^(.+?):\s.*\s-\s\S*\s*(Connected|Needs authentication|Failed.*|Not configured.*)\s*$", line)
        if match:
            servers[normalize(match[1])] = {"display": match[1], "status": match[2]}
    if not servers:
        raise ValueError("в выводе mcp list нет серверов")
    return servers


def parse_plugin_details(text):
    costs = re.search(r"Always-on:\s*~?([\d.,]+k?)", text)
    component = lambda label: int((re.search(rf"^\s*{label} \((\d+)\)", text, re.M) or [0, 0])[1])
    return {"always_on": parse_tokens(costs[1]) if costs else 0,
            "skills": component("Skills"), "agents": component("Agents"),
            "hooks": component("Hooks"), "mcp": component("MCP servers"),
            "lsp": component("LSP servers")}


# --- стенограммы ---

TOOL_USE = re.compile(rb'"type":"tool_use","id":"(toolu_[^"]+)","name":"([^"]+)"')
SKILL_INPUT = re.compile(rb'"input":\{"skill":"([^"]+)"')
SUBAGENT_INPUT = re.compile(rb'"subagent_type":"([^"]+)"')
SLASH_COMMAND = re.compile(rb'<command-name>/?([\w:.-]+)</command-name>')
LINE_DATE = re.compile(rb'"timestamp":"(\d{4}-\d\d-\d\d)')


def bump(bucket, key, day, session, project, window_start):
    entry = bucket.setdefault(key, {"window": 0, "history": 0, "last": "",
                                    "sessions": set(), "projects": set()})
    entry["history"] += 1
    entry["last"] = max(entry["last"], day)
    entry["projects"].add(project)
    if day >= window_start:
        entry["window"] += 1
        entry["sessions"].add(session)


def scan_transcripts(root, today, window_days, history_days):
    history_start = (today - dt.timedelta(days=history_days)).isoformat()
    window_start = (today - dt.timedelta(days=window_days)).isoformat()
    cutoff = time.mktime((today - dt.timedelta(days=history_days)).timetuple())
    usage = {"mcp": {}, "tools_by_server": {}, "skills": {}, "commands": {}, "agents": {}}
    seen_ids = set()
    files = 0
    bytes_read = 0
    oldest = today.isoformat()
    for path in Path(root).rglob("*.jsonl"):
        try:
            if path.stat().st_mtime < cutoff:
                continue
            bytes_read += path.stat().st_size
            handle = path.open("rb")
        except OSError:
            continue
        files += 1
        relative = path.relative_to(root).parts
        project = relative[0] if len(relative) > 1 else "?"
        session = relative[1].removesuffix(".jsonl") if len(relative) > 1 else path.stem
        with handle:
            for line in handle:
                has_tool = b'"tool_use"' in line
                if not has_tool and b"command-name" not in line:
                    continue
                stamp = LINE_DATE.search(line)
                day = stamp[1].decode() if stamp else today.isoformat()
                if day < history_start:
                    continue
                oldest = min(oldest, day)
                matches = list(TOOL_USE.finditer(line)) if has_tool else []
                for index, match in enumerate(matches):
                    if match[1] in seen_ids:
                        continue
                    seen_ids.add(match[1])
                    name = match[2].decode()
                    end = matches[index + 1].start() if index + 1 < len(matches) else len(line)
                    segment = line[match.end():end]
                    if name.startswith("mcp__"):
                        server, _, tool = name[5:].partition("__")
                        bump(usage["mcp"], server, day, session, project, window_start)
                        usage["tools_by_server"].setdefault(server, set()).add(tool)
                    elif name == "Skill":
                        found = SKILL_INPUT.search(segment)
                        if found:
                            bump(usage["skills"], found[1].decode(), day, session, project, window_start)
                    elif name == "Agent":
                        found = SUBAGENT_INPUT.search(segment)
                        if found:
                            bump(usage["agents"], found[1].decode(), day, session, project, window_start)
                if b"command-name" in line and b'"type":"user"' in line:
                    for found in SLASH_COMMAND.finditer(line):
                        bump(usage["commands"], found[1].decode(), day, session, project, window_start)
    usage["files"], usage["bytes"], usage["oldest"] = files, bytes_read, oldest
    return usage


def startup_snapshot(root):
    """Что реально ушло в стартовый контекст последней сессии: имена, инструкции, вставки хуков."""
    paths = sorted(Path(root).glob("*/*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    for path in paths[:40]:
        snapshot = {"path": str(path), "names": {}, "builtin_names_tokens": 0, "instructions": {},
                    "hooks": [], "skill_listing_tokens": 0, "needs_auth": [], "failed": []}
        found = False
        with path.open(errors="replace") as handle:
            for index, line in enumerate(handle):
                if index > STARTUP_LINES_TO_READ:
                    break
                if '"attachment"' not in line:
                    continue
                try:
                    attachment = json.loads(line).get("attachment") or {}
                except json.JSONDecodeError:
                    continue
                kind = attachment.get("type")
                if kind == "deferred_tools_delta" and not found:
                    found = True
                    for name in attachment.get("addedNames", []):
                        match = re.match(r"mcp__(.+?)__", name)
                        if match:
                            entry = snapshot["names"].setdefault(match[1], {"count": 0, "chars": 0, "tools": set()})
                            entry["count"] += 1
                            entry["chars"] += len(name) + 1
                            entry["tools"].add(name.split("__", 2)[-1])
                        else:
                            snapshot["builtin_names_tokens"] += tokens_from_chars(len(name) + 1)
                    snapshot["needs_auth"] = attachment.get("needsAuthMcpServers", [])
                    snapshot["failed"] = attachment.get("failedMcpServers", [])
                elif kind == "mcp_instructions_delta" and not snapshot["instructions"]:
                    for name, block in zip(attachment.get("addedNames", []), attachment.get("addedBlocks", [])):
                        snapshot["instructions"][normalize(name)] = tokens_from_chars(len(block))
                elif kind == "skill_listing" and not snapshot["skill_listing_tokens"]:
                    snapshot["skill_listing_tokens"] = tokens_from_chars(len(str(attachment.get("content", ""))))
                elif kind == "hook_additional_context":
                    content = str(attachment.get("content", ""))
                    snapshot["hooks"].append({"event": attachment.get("hookEvent", "?"),
                                              "tokens": tokens_from_chars(len(content)),
                                              "head": re.sub(r"[\s'\"\[]+", " ", content[:70]).strip()})
        if found:
            return snapshot
    raise ValueError("ни в одной из 40 свежих стенограмм нет deferred_tools_delta")


# --- бесплатные проверки конфига ---

def directory_mib(path):
    total = 0
    for base, _, names in os.walk(path):
        for name in names:
            try:
                total += os.lstat(os.path.join(base, name)).st_size
            except OSError:
                pass
    return round(total / 2**20)


def scan_config(home, plugins):
    claude = home / ".claude"
    settings = json.loads((claude / "settings.json").read_text())
    orphans = []
    for groups in (settings.get("hooks") or {}).values():
        for group in groups:
            for hook in group.get("hooks", []):
                command = hook.get("command", "")
                for token in re.findall(r"(?:~|\$HOME|\$\{HOME\}|/Users/[^/\s\"']+)/[^\s\"';|&]+", command):
                    token = token.rstrip(".,:)")
                    path = re.sub(r"^(~|\$HOME|\$\{HOME\})", str(home), token)
                    if not Path(path).exists():
                        orphans.append(token)
    allow = (settings.get("permissions") or {}).get("allow", [])
    duplicates = sorted({rule for rule in allow if allow.count(rule) > 1})
    broad = [rule for rule in allow if re.fullmatch(r"(Bash|Read|Write|Edit)\(\*\)|Bash", rule)]
    active = {item.get("installPath") for item in plugins}
    stale_versions = 0
    cache = claude / "plugins/cache"
    if cache.is_dir() and active:
        for version in cache.glob("*/*/*"):
            if version.is_dir() and str(version) not in active:
                stale_versions += 1
    trash = claude / "_gc_trash"
    next_review = None
    gc_log = claude / "gc_log.md"
    if gc_log.exists():
        dates = re.findall(r"(?:следующ\w+ обзор|next review)\D{0,20}(\d{4}-\d\d-\d\d)", gc_log.read_text(), re.I)
        next_review = max(dates) if dates else None
    return {"orphan_hook_paths": sorted(set(orphans)), "duplicate_allow": duplicates,
            "broad_allow": broad, "allow_rules": len(allow), "stale_plugin_versions": stale_versions,
            "plugin_cache_mib": directory_mib(cache) if cache.is_dir() else 0,
            "gc_trash_mib": directory_mib(trash) if trash.is_dir() else 0,
            "gc_next_review": next_review}


def last_line(text, pattern=None):
    lines = [line for line in text.strip().splitlines() if line.strip()]
    if pattern:
        lines = [line for line in lines if re.search(pattern, line)]
    return lines[-1][:220] if lines else ""


def scan_helpers(home, cwd):
    skills = home / ".claude/skills/skill-stocktake/scripts"
    out = {}
    out["skill_lint"] = last_line(run(["bash", str(skills / "lint.sh")])[1], r"^skill-lint:")
    out["skill_corpus"] = last_line(run([sys.executable, str(skills / "corpus.py")])[1], r"^corpus:")
    out["instructions_drift"] = last_line(run([sys.executable, str(home / ".claude/instructions-drift.py")])[1])
    audits = sorted((home / ".claude/audits").glob("*-audit.json"))
    out["last_setup_audit"] = audits[-1].name[:10] if audits else None
    vault_audit = Path(cwd) / ".claude/skills/vault-audit/audit.py"
    if vault_audit.exists():
        code, stdout, _ = run([sys.executable, str(vault_audit)], cwd=cwd)
        out["vault_audit"] = f"код {code}: {last_line(stdout)}"
    return out


def spend_week(today):
    since = (today - dt.timedelta(days=7)).strftime("%Y%m%d")
    data = json.loads(checked(["ccusage", "daily", "--json", "--since", since]))
    totals = data.get("totals") or {}
    return {"cost_usd": round(totals.get("totalCost", 0), 2), "tokens": totals.get("totalTokens", 0)}


# --- сведение и классификация ---

def read_keep(path, today):
    active, expired = {}, []
    try:
        lines = Path(path).read_text().splitlines()
    except OSError:
        return active, expired
    for line in lines:
        if not line.strip() or line.startswith("#"):
            continue
        cells = line.split("\t")
        key = (cells[0], normalize(cells[1]))
        review_after = cells[3].strip() if len(cells) > 3 else ""
        if review_after and review_after < today.isoformat():
            expired.append({"kind": cells[0], "name": cells[1], "review_after": review_after})
        else:
            active[key] = cells[2] if len(cells) > 2 else ""
    return active, expired


def server_origin(key, config_keys):
    if key.startswith("claude_ai_"):
        return "claude.ai"
    if key.startswith("plugin_"):
        return "plugin"
    return "config" if key in config_keys else "?"


def resolve_alias(server, tools, known):
    """UUID-имена Desktop сводятся к серверу по пересечению инструментов."""
    if normalize(server) in known:
        return normalize(server)
    best, best_overlap = None, 0.0
    for key, entry in known.items():
        reference = set(entry.get("tool_names") or [])
        if reference and tools:
            overlap = len(tools & reference) / len(tools)
            if overlap > best_overlap:
                best, best_overlap = key, overlap
    return best if best_overlap >= 0.5 else None


def merge_servers(context, status, snapshot, usage, config_keys):
    known = {}
    for raw, entry in (context or {}).get("servers", {}).items():
        known[normalize(raw)] = {"display": raw, "tool_names": entry["tools"], "tools": len(entry["tools"]),
                                 "schema_tokens": entry["schema_tokens"], "status": None}
    for key, entry in (status or {}).items():
        target = known.setdefault(key, {"display": entry["display"], "tool_names": [], "tools": 0,
                                        "schema_tokens": 0, "status": None})
        target["status"], target["display"] = entry["status"], entry["display"]
    # упавшие серверы `claude mcp list` не показывает, они есть только в стартовом вложении
    for failed in (snapshot or {}).get("failed", []):
        name = failed.get("name", "?") if isinstance(failed, dict) else str(failed)
        known.setdefault(normalize(name), {"display": name, "tool_names": [], "tools": 0, "schema_tokens": 0,
                                           "status": "Failed to connect"})
    for entry in known.values():
        entry.update(startup_tokens=0, instructions_tokens=0, window=0, history=0, last="",
                     sessions=set(), projects=set())
    outside = {}
    snapshot = snapshot or {"names": {}, "instructions": {}}
    for raw, entry in snapshot["names"].items():
        key = resolve_alias(raw, entry["tools"], known)
        if key:
            known[key]["startup_tokens"] += tokens_from_chars(entry["chars"])
            # /context в -p может опередить подключение сервера и показать 0 инструментов
            known[key]["tools"] = max(known[key]["tools"], entry["count"])
        else:
            outside[raw] = {"startup_tokens": tokens_from_chars(entry["chars"]), "calls": 0}
    for key, tokens in snapshot["instructions"].items():
        if key in known:
            known[key]["instructions_tokens"] = tokens
    usage = usage or {"mcp": {}, "tools_by_server": {}}
    for raw, entry in usage["mcp"].items():
        key = resolve_alias(raw, usage["tools_by_server"].get(raw, set()), known)
        if key is None:
            outside.setdefault(raw, {"startup_tokens": 0, "calls": 0})["calls"] += entry["window"]
            continue
        target = known[key]
        target["window"] += entry["window"]
        target["history"] += entry["history"]
        target["last"] = max(target["last"], entry["last"])
        target["sessions"] |= entry["sessions"]
        target["projects"] |= entry["projects"]
    for key, entry in known.items():
        entry["origin"] = server_origin(key, config_keys)
        entry["cost"] = entry["startup_tokens"] + entry["instructions_tokens"]
    return known, outside


SERVER_ACTION = {
    "claude.ai": "выключить коннектор для Claude Code в /mcp (на claude.ai он останется)",
    "plugin": "выключить сервер или плагин в /plugin",
    "config": "убрать через /config-gc (мягко, с журналом и откатом)",
    "?": "выяснить источник сервера в /mcp",
}


def classify(servers, plugins, doctor, usage, thresholds, keep, history_covered, agents=None):
    candidates = []

    def add(kind, name, action, confidence, saving, evidence):
        reason = keep.get((kind, normalize(name)))
        candidates.append({"kind": kind, "name": name, "action": action, "confidence": confidence,
                           "saving": saving, "evidence": evidence, "kept": reason})

    for key, entry in servers.items():
        status = entry["status"] or ""
        name = entry["display"]
        if status.startswith("Needs auth") or status.startswith("Failed") or status.startswith("Not configured"):
            add("mcp", name, "авторизовать в /mcp или выключить", "high", 0,
                f"статус: {status}; инструментов нет, строка в напоминании на каждом старте")
        elif entry["history"] == 0 and entry["tools"]:
            confidence = "high" if history_covered else "medium"
            add("mcp", name, SERVER_ACTION[entry["origin"]], confidence, entry["cost"],
                f"0 вызовов за {thresholds['history_days']} дн, инструментов {entry['tools']}")
        elif entry["window"] == 0 and entry["tools"]:
            add("mcp", name, SERVER_ACTION[entry["origin"]], "medium", entry["cost"],
                f"0 вызовов за {thresholds['usage_window_days']} дн, последний {entry['last']}")
        elif (entry["window"] < thresholds["low_use_calls"] and len(entry["projects"]) == 1
              and entry["cost"] >= thresholds["low_use_min_startup_tokens"]):
            add("mcp", name, "перенести в проектный scope", "low", entry["cost"],
                f"{entry['window']} вызовов, один проект")

    for plugin in plugins:
        if not plugin.get("enabled"):
            continue
        name = plugin["id"].split("@")[0]
        detail = plugin.get("details") or {}
        idle = (doctor or {}).get("idle_plugins", {}).get(name)
        passive = (detail.get("hooks") or detail.get("lsp") or detail.get("mcp")
                   or plugin.get("readFromFolder") or "local-mods" in plugin["id"])
        plugin["passive"] = bool(passive)
        always_on = detail.get("always_on", 0)
        if idle is not None and idle >= thresholds["plugin_idle_days"] and not passive and always_on:
            add("plugin", name, "выключить в /plugin (ключ false в enabledPlugins не удалять)", "medium",
                always_on, f"не использовался {idle} дн, только скиллы и агенты")

    called = set()
    if usage:
        for bucket in ("skills", "commands"):
            called |= {name for name, entry in usage[bucket].items() if entry["history"]}
    conflicts = []
    for skill in (doctor or {}).get("skills", []):
        if skill["uses"] == 0 and skill["name"] in called:
            conflicts.append(skill["name"])
            continue
        if skill["uses"] == 0 and skill["context"] >= thresholds["skill_candidate_min_tokens"]:
            source = skill["source"]
            if source == "userSettings":
                action = "skillOverrides: user-invocable-only (подтверждение, diff)"
            elif "claude" in source.lower() or "sync" in source.lower():
                action = "выключить в claude.ai"
            else:
                action = "отдельно не выключается, только плагин целиком"
            add("skill", skill["name"], action, "medium" if source == "userSettings" else "low", skill["context"],
                f"источник {source}, вызовов 0, в стенограммах тоже нет")
    idle_agents = [a for a in agents or [] if not (usage and usage["agents"].get(a["Agent Type"], {}).get("history"))
                   and ("agent", normalize(a["Agent Type"])) not in keep]
    if idle_agents:
        names = sorted(a["Agent Type"] for a in idle_agents)
        add("agent", f"{len(names)} кастомных агентов", "перенести из ~/.claude/agents через /config-gc, оставить нужные",
            "medium", sum(parse_tokens(a["Tokens"]) for a in idle_agents),
            f"0 вызовов за {thresholds['history_days']} дн: {', '.join(names[:6])} и другие, полный список в JSON")
        candidates[-1]["names"] = names
    candidates.sort(key=lambda c: (c["kept"] is not None, -c["saving"], c["kind"], c["name"]))
    return candidates, conflicts


def find_duplicate_skills(doctor):
    """Один скилл и в ~/.claude/skills, и в плагине: в листинге строка оплачивается дважды."""
    skills = (doctor or {}).get("skills", [])
    plain = {s["name"]: s for s in skills if ":" not in s["name"]}
    return [{"name": s["name"], "tokens": min(s["context"], plain[s["name"].split(":")[-1]]["context"])}
            for s in skills
            if ":" in s["name"] and s["name"].split(":")[-1] in plain
            and s["context"] and plain[s["name"].split(":")[-1]]["context"]]


def compare(previous, categories, candidates, thresholds):
    if not previous:
        return None
    changes = []
    for name, value in categories.items():
        before = previous.get("context", {}).get("categories", {}).get(name)
        if before is None or name in ("Free space", "Messages"):
            continue
        delta = value - before
        if abs(delta) >= thresholds["delta_flag_min_tokens"] and abs(delta) * 100 >= thresholds["delta_flag_pct"] * max(before, 1):
            changes.append({"category": name, "before": before, "after": value})
    key = lambda c: f"{c['kind']}:{c['name']}"
    before_set = {key(c) for c in previous.get("candidates", []) if not c.get("kept")}
    after_set = {key(c) for c in candidates if not c.get("kept")}
    return {"from": previous.get("date"), "changes": changes,
            "new": sorted(after_set - before_set), "gone": sorted(before_set - after_set)}


# --- отчёт ---

def table(headers, rows):
    lines = ["| " + " | ".join(headers) + " |", "|" + "---|" * len(headers)]
    lines += ["| " + " | ".join(str(cell).replace("|", "\\|") for cell in row) + " |" for row in rows]
    return lines


def render(report, thresholds):
    out = [f"# Hygiene sweep — {report['date']}", ""]
    failed = {k: v for k, v in report["sources"].items() if v["status"] != "ok"}
    active = [c for c in report["candidates"] if not c.get("kept")]
    saving = {}
    for candidate in active:
        saving[candidate["kind"]] = saving.get(candidate["kind"], 0) + candidate["saving"]
    context = report.get("context") or {}
    categories = context.get("categories", {})
    out += [f"Кандидатов {len(active)}, оценка экономии на старт ~{sum(saving.values())} ток "
            f"({', '.join(f'{k} {v}' for k, v in sorted(saving.items())) or 'нет'}). "
            f"Источников ок {len(report['sources']) - len(failed)} из {len(report['sources'])}. Ничего не применено.", ""]
    if failed:
        out += ["## Упавшие источники", ""]
        out += [f"- `{k}`: {v['error']}" for k, v in failed.items()] + [""]

    out += ["## Цена старта", ""]
    if categories:
        out += [f"`/context`: {context['total']} из {context['limit']} ток, модель {context['model']}.", ""]
        out += table(["Категория", "Токены"], [[k, v] for k, v in categories.items()]) + [""]
    snapshot = report.get("startup")
    if snapshot:
        names_total = sum(tokens_from_chars(v["chars"]) for v in snapshot["names"].values())
        out += [f"Список имён отложенных инструментов в последней сессии: ~{names_total + snapshot['builtin_names_tokens']} ток "
                f"(MCP {names_total}). Оценка chars/{CHARS_PER_TOKEN}. Отдельной строкой в `/context` этого нет.",
                f"Вставки хуков на старте: ~{sum(h['tokens'] for h in snapshot['hooks'])} ток.", ""]
        heavy = sorted(snapshot["hooks"], key=lambda h: -h["tokens"])[:5]
        out += [f"- {h['event']} ~{h['tokens']}: {h['head']}" for h in heavy] + [""]

    out += ["## Кандидаты", ""]
    if active:
        out += table(["Тип", "Имя", "Действие", "Уверенность", "Экономия", "Основание"],
                     [[c["kind"], c["name"], c["action"], c["confidence"], c["saving"], c["evidence"]]
                      for c in active]) + [""]
    else:
        out += ["Нет.", ""]
    kept = [c for c in report["candidates"] if c.get("kept")]
    if kept:
        out += ["Оставлено по keep-листу: " + ", ".join(f"{c['name']} ({c['kept']})" for c in kept), ""]
    if report.get("keep_expired"):
        out += ["Срок keep-записи истёк, пересмотреть: " + ", ".join(e["name"] for e in report["keep_expired"]), ""]

    if report.get("servers"):
        out += ["## MCP", ""]
        rows = sorted(report["servers"].values(), key=lambda s: -s["cost"])
        out += table(["Сервер", "Источник", "Статус", "Инстр.", "Старт, ток", "Схемы (отложены)",
                      f"Вызовы {thresholds['usage_window_days']}д", f"Вызовы {thresholds['history_days']}д", "Сессии", "Последний"],
                     [[s["display"], s["origin"], s["status"] or "-", s["tools"], s["cost"], s["schema_tokens"],
                       s["window"], s["history"], s["sessions"], s["last"] or "-"] for s in rows]) + [""]
    if report.get("servers_outside"):
        out += ["Вне `claude mcp list` (встроенные в приложение, не кандидаты): "
                + ", ".join(sorted(report["servers_outside"])), ""]

    if report.get("plugins"):
        out += ["## Плагины", ""]
        rows = sorted((p for p in report["plugins"] if p.get("enabled")),
                      key=lambda p: -(p.get("details") or {}).get("always_on", 0))
        out += table(["Плагин", "Постоянно, ток", "Скиллы", "Агенты", "Хуки", "MCP", "LSP", "Пассивный"],
                     [[p["id"].split("@")[0], *[(p.get("details") or {}).get(k, "?") for k in
                       ("always_on", "skills", "agents", "hooks", "mcp", "lsp")], "да" if p.get("passive") else "нет"]
                      for p in rows]) + [""]

    if report.get("skill_conflicts"):
        out += ["## Расхождения", "", "`/skill-doctor` считает 0 вызовов, но в стенограммах вызовы есть: "
                + ", ".join(report["skill_conflicts"]), ""]

    if report.get("skill_duplicates"):
        out += ["## Дубли в листинге", "", "Скилл виден и как свой, и как плагинный: "
                + ", ".join(f"{d['name']} (~{d['tokens']})" for d in report["skill_duplicates"]), ""]

    config, helpers = report.get("config") or {}, report.get("helpers") or {}
    if config or helpers:
        out += ["## Бесплатные проверки", ""]
        if config:
            out += [f"- Хуки с несуществующим путём: {config['orphan_hook_paths'] or 'нет'}",
                    f"- Allow-правил {config['allow_rules']}, дублей {len(config['duplicate_allow'])}, широких: {config['broad_allow'] or 'нет'}",
                    f"- Кэш плагинов {config['plugin_cache_mib']} МиБ, неактивных версий {config['stale_plugin_versions']}; `_gc_trash` {config['gc_trash_mib']} МиБ",
                    f"- Следующий обзор config-gc: {config['gc_next_review'] or 'не записан'}"]
        out += [f"- {key}: {value}" for key, value in helpers.items()]
        spend = report.get("spend")
        if spend:
            out += [f"- ccusage за 7 дней: ${spend['cost_usd']}, {spend['tokens']} ток"]
        out += [""]

    delta = report.get("delta")
    out += ["## Дельта", ""]
    if delta:
        out += [f"Сравнение с {delta['from']}.",
                *[f"- {c['category']}: {c['before']} → {c['after']}" for c in delta["changes"]],
                f"- Новые кандидаты: {delta['new'] or 'нет'}", f"- Ушли: {delta['gone'] or 'нет'}", ""]
    else:
        out += ["Первый прогон, сравнивать не с чем.", ""]

    usage = report.get("usage_meta")
    out += ["## Границы", ""]
    if usage:
        out += [f"- Просмотрено стенограмм {usage['files']}, {usage['bytes'] // 2**20} МиБ, самая старая запись {usage['oldest']}."]
    out += ["- Нулевые вызовы видны только в Claude Code на этой машине: claude.ai, Cowork и другие агенты сюда не попадают.",
            "- Экономия считается по именам и инструкциям. Схемы отложены и в контекст старта не входят, пока не загружены.",
            "- Пассивный плагин (хуки, LSP, мод интерфейса) работает без вызовов, поэтому не считается мёртвым.",
            "- Применение только вручную: `/config-gc` или правки с подтверждением.", ""]
    return "\n".join(out)


def to_plain(value):
    if isinstance(value, set):
        return sorted(value)
    raise TypeError(type(value))


def previous_report(out_dir, today):
    reports = sorted(p for p in Path(out_dir).glob("hygiene-*.json") if today.isoformat() not in p.name)
    if not reports:
        return None
    try:
        return json.loads(reports[-1].read_text())
    except (OSError, json.JSONDecodeError):
        return None


def append_budget_log(path, today, context):
    summary = ";".join(f"{normalize(k)}={v}" for k, v in context["categories"].items())
    with open(path, "a") as handle:
        handle.write(f"{today}\t{context['model']}\t{context['total']}\tsweep;{summary}\n")


def collect(args, today, thresholds):
    home = Path(args.home).expanduser()
    root = home / ".claude/projects"
    claude = claude_bin()
    sources, results = {}, {}

    def source(name, function):
        started = time.time()
        try:
            results[name] = function()
            sources[name] = {"status": "ok", "seconds": round(time.time() - started, 1)}
        except Exception as error:
            results[name] = None
            sources[name] = {"status": "failed", "error": f"{type(error).__name__}: {str(error)[:200]}",
                             "seconds": round(time.time() - started, 1)}

    def plugin_list():
        items = json.loads(checked([claude, "plugin", "list", "--json"]))
        enabled = [item for item in items if item.get("enabled")]

        def fill(item):
            item["details"] = parse_plugin_details(checked([claude, "plugin", "details", item["id"]]))

        with futures.ThreadPoolExecutor(thresholds["plugin_details_workers"]) as pool:
            list(pool.map(fill, enabled))
        return items

    plan = {
        "context": lambda: parse_context(checked([claude, "-p", "/context", "--no-session-persistence"])),
        "skill_doctor": lambda: parse_skill_doctor(checked([claude, "-p", "/skill-doctor", "--no-session-persistence"])),
        "mcp_status": lambda: parse_mcp_list(checked([claude, "mcp", "list"])),
        "plugins": plugin_list,
        "transcripts": lambda: scan_transcripts(root, today, thresholds["usage_window_days"], thresholds["history_days"]),
        "startup": lambda: startup_snapshot(root),
        "config": lambda: scan_config(home, results.get("plugins") or []),
        "helpers": lambda: scan_helpers(home, os.getcwd()),
        "spend": lambda: spend_week(today),
    }
    for name, function in plan.items():
        if args.skip and name in args.skip:
            continue
        source(name, function)
    return sources, results, home


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", default="~")
    parser.add_argument("--out-dir", default=None)
    parser.add_argument("--skip", nargs="*", default=[], help="имена источников, которые не запускать")
    parser.add_argument("--log", action="store_true", help="дописать строку в context-budget-log.tsv")
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args(argv)
    if args.selftest:
        return selftest()

    today = dt.date.today()
    home = Path(args.home).expanduser()
    thresholds = read_thresholds(home / ".claude/thresholds.yaml")
    sources, results, home = collect(args, today, thresholds)
    out_dir = Path(args.out_dir or home / ".claude/audits")
    out_dir.mkdir(parents=True, exist_ok=True)

    config_data = {}
    try:
        config_data = json.loads((home / ".claude.json").read_text())
    except (OSError, json.JSONDecodeError):
        pass
    config_keys = {normalize(k) for k in config_data.get("mcpServers", {})}
    for project in config_data.get("projects", {}).values():
        config_keys |= {normalize(k) for k in project.get("mcpServers", {})}

    usage = results.get("transcripts")
    context = results.get("context")
    servers, outside = merge_servers(context, results.get("mcp_status"), results.get("startup"), usage, config_keys)
    keep, keep_expired = read_keep(out_dir / "hygiene-keep.tsv", today)
    history_start = (today - dt.timedelta(days=thresholds["history_days"])).isoformat()
    history_covered = bool(usage) and usage["oldest"] <= history_start
    plugins = results.get("plugins") or []
    candidates, conflicts = classify(servers, plugins, results.get("skill_doctor"), usage, thresholds, keep, history_covered, (context or {}).get("agents"))

    for entry in servers.values():
        entry["sessions"] = len(entry["sessions"])
        entry["projects"] = len(entry["projects"])
        entry.pop("tool_names", None)
    snapshot = results.get("startup")
    report = {
        "date": today.isoformat(), "cwd": os.getcwd(), "thresholds": thresholds, "sources": sources,
        "context": {k: v for k, v in (context or {}).items() if k != "servers"} if context else None,
        "startup": snapshot, "servers": servers, "servers_outside": outside, "plugins": plugins,
        "skill_doctor": results.get("skill_doctor"), "skill_conflicts": conflicts,
        "skill_duplicates": find_duplicate_skills(results.get("skill_doctor")), "candidates": candidates,
        "keep_expired": keep_expired, "config": results.get("config"), "helpers": results.get("helpers"),
        "spend": results.get("spend"),
        "usage_meta": {k: usage[k] for k in ("files", "bytes", "oldest")} if usage else None,
    }
    report["delta"] = compare(previous_report(out_dir, today), (context or {}).get("categories", {}), candidates, thresholds)
    stem = out_dir / f"hygiene-{today}"
    stem.with_suffix(".md").write_text(render(report, thresholds))
    stem.with_suffix(".json").write_text(json.dumps(report, ensure_ascii=False, indent=1, default=to_plain))
    if args.log and context:
        append_budget_log(home / ".claude/context-budget-log.tsv", today, context)

    failed = [k for k, v in sources.items() if v["status"] != "ok"]
    active = [c for c in candidates if not c.get("kept")]
    print(f"{stem}.md: кандидатов {len(active)}, экономия ~{sum(c['saving'] for c in active)} ток, упало источников {len(failed)} {failed or ''}")
    return 1 if failed else 0


def selftest():
    today = dt.date(2026, 11, 6)
    errors = []

    def check(name, condition):
        if not condition:
            errors.append(name)

    check("parse_tokens", parse_tokens("2.7k") == 2700 and parse_tokens("~240") == 240 and parse_tokens("-") == 0)
    context = parse_context("**Model:** m\n**Tokens:** 1.5k / 250k (1%)\n\n### Estimated usage by category\n\n"
                            "| Category | Tokens | Percentage |\n|---|---|---|\n| Skills | 1k | 1% |\n\n### MCP Tools\n\n"
                            "| Tool | Server | Tokens |\n|---|---|---|\n| mcp__dead__a | dead | 100 |\n| mcp__live__b | live | 50 |\n")
    check("parse_context", context["categories"] == {"Skills": 1000} and context["total"] == 1500
          and context["servers"]["dead"]["tools"] == ["a"])
    try:
        parse_context("мусор")
        errors.append("parse_context не падает на мусоре")
    except ValueError:
        pass
    check("skill_doctor", parse_skill_doctor("  a  userSettings  ~240  -  0×  never\n\n  plug  last used 44 days ago\n")
          == {"skills": [{"name": "a", "source": "userSettings", "context": 240, "uses": 0, "last": "never"}],
              "idle_plugins": {"plug": 44}})
    check("источник с пробелом", parse_skill_doctor("  a  claude.ai sync  ~240  5.3m  2×  83 days\n")["skills"][0]["source"] == "claude.ai sync")
    check("mcp_list", parse_mcp_list("claude.ai Exa: https://x - ✔ Connected\nplugin:e:s: https://y (HTTP) - ! Needs authentication\n")
          == {"claude_ai_exa": {"display": "claude.ai Exa", "status": "Connected"},
              "plugin_e_s": {"display": "plugin:e:s", "status": "Needs authentication"}})

    with tempfile.TemporaryDirectory() as temp:
        project = Path(temp) / "p"
        project.mkdir()
        call = {"type": "assistant", "timestamp": "2026-11-05T00:00:00Z", "message": {"content": [
            {"type": "tool_use", "id": "toolu_1", "name": "mcp__live__b", "input": {}}]}}
        quoted = {"type": "user", "timestamp": "2026-11-05T00:00:00Z", "message": {"content": [
            {"type": "text", "text": json.dumps({"type": "tool_use", "id": "toolu_9", "name": "mcp__dead__a"}, separators=(",", ":"))}]}}
        skill = {"type": "assistant", "timestamp": "2026-11-05T00:00:00Z", "message": {"content": [
            {"type": "tool_use", "id": "toolu_2", "name": "Skill", "input": {"skill": "used"}}]}}
        old = {"type": "assistant", "timestamp": "2026-01-01T00:00:00Z", "message": {"content": [
            {"type": "tool_use", "id": "toolu_3", "name": "mcp__live__b", "input": {}}]}}
        dumps = lambda o: json.dumps(o, separators=(",", ":"))
        (project / "s.jsonl").write_text("\n".join(map(dumps, [call, call, quoted, skill, old])))
        usage = scan_transcripts(temp, today, 30, 90)
    check("дедуп по id и отсев старого", usage["mcp"].get("live", {}).get("history") == 1)
    check("цитата в тексте не вызов", "dead" not in usage["mcp"])
    check("скилл найден", usage["skills"].get("used", {}).get("window") == 1)

    thresholds = dict(DEFAULTS)
    status = {"plugin_x_broken": {"display": "plugin:x:broken", "status": "Needs authentication"}}
    snapshot = {"names": {"dead": {"count": 1, "chars": 400, "tools": {"a"}},
                          "11111111-aaaa": {"count": 1, "chars": 80, "tools": {"b"}}},
                "instructions": {"dead": 50}}
    servers, _ = merge_servers(context, status, snapshot, usage, {"dead", "live"})
    check("uuid сведён по инструментам", servers["live"]["startup_tokens"] == 20)
    check("usage на live", servers["live"]["window"] == 1)
    check("упавший из снимка", merge_servers(None, None, {"names": {}, "instructions": {}, "failed": [{"name": "plugin:e:gh"}]},
                                             None, set())[0]["plugin_e_gh"]["status"].startswith("Failed"))
    check("инструменты из снимка", merge_servers({"servers": {"s": {"tools": [], "schema_tokens": 0}}}, None,
                                                 {"names": {"s": {"count": 5, "chars": 40, "tools": set()}}, "instructions": {}},
                                                 None, set())[0]["s"]["tools"] == 5)
    plugins = [{"id": "skills@m", "enabled": True, "details": {"always_on": 300, "hooks": 0, "lsp": 0, "mcp": 0}},
               {"id": "hooks@m", "enabled": True, "details": {"always_on": 300, "hooks": 2, "lsp": 0, "mcp": 0}},
               {"id": "mod@local-mods", "enabled": True, "details": {"always_on": 300, "hooks": 0, "lsp": 0, "mcp": 0}},
               {"id": "free@m", "enabled": True, "details": {"always_on": 0, "hooks": 0, "lsp": 0, "mcp": 0}}]
    doctor = {"skills": [{"name": "idle", "source": "userSettings", "context": 200, "uses": 0, "last": "never"},
                         {"name": "used", "source": "userSettings", "context": 200, "uses": 0, "last": "never"}],
              "idle_plugins": {"skills": 40, "hooks": 40, "mod": 40, "free": 40}}
    candidates, conflicts = classify(servers, plugins, doctor, usage, thresholds, {("mcp", "dead"): "нужен"}, True)
    names = {(c["kind"], c["name"]) for c in candidates if not c["kept"]}
    check("keep-лист глушит", ("mcp", "dead") not in names and any(c["kept"] == "нужен" for c in candidates))
    check("сломанный сервер — кандидат", ("mcp", "plugin:x:broken") in names)
    check("живой не кандидат", ("mcp", "live") not in names)
    check("плагин из скиллов — кандидат", ("plugin", "skills") in names)
    check("хуки, мод и бесплатный — нет", not names & {("plugin", "hooks"), ("plugin", "mod"), ("plugin", "free")})
    check("скилл без вызовов — кандидат", ("skill", "idle") in names)
    check("расхождение со стенограммой", conflicts == ["used"] and ("skill", "used") not in names)
    plugin_skill, _ = classify({}, [], {"skills": [{"name": "p:s", "source": "p", "context": 200, "uses": 0, "last": "never"}],
                                        "idle_plugins": {}}, None, thresholds, {}, True)
    check("плагинный скилл не через skillOverrides", "только плагин" in plugin_skill[0]["action"])
    agent_candidates, _ = classify({}, [], None, {"agents": {"used": {"history": 1}}, "skills": {}, "commands": {}}, thresholds,
                                   {("agent", "kept"): "нужен"}, True,
                                   [{"Agent Type": "idle", "Tokens": "90"}, {"Agent Type": "used", "Tokens": "90"},
                                    {"Agent Type": "kept", "Tokens": "90"}])
    check("агенты", len(agent_candidates) == 1 and agent_candidates[0]["names"] == ["idle"] and agent_candidates[0]["saving"] == 90)
    check("дубль", find_duplicate_skills({"skills": [{"name": "a", "context": 90}, {"name": "x:a", "context": 80},
                                                     {"name": "x:b", "context": 80}]}) == [{"name": "x:a", "tokens": 80}])
    delta = compare({"date": "x", "context": {"categories": {"Skills": 500}}, "candidates": [{"kind": "mcp", "name": "old"}]},
                    {"Skills": 2000}, candidates, thresholds)
    check("дельта", delta["changes"] and "mcp:old" in delta["gone"] and "plugin:skills" in delta["new"])

    with tempfile.TemporaryDirectory() as temp:
        home = Path(temp)
        keep_file = home / "k.tsv"
        keep_file.write_text("# c\nmcp\tA\tпричина\t2099-01-01\nmcp\tB\tпричина\t2020-01-01\n")
        active, expired = read_keep(keep_file, today)
        check("срок keep", ("mcp", "a") in active and expired[0]["name"] == "B")
        (home / ".claude").mkdir()
        args = argparse.Namespace(home=temp, skip=[])
        # пустой дом и сломанный бинарь: падает источник, а не прогон
        saved = {key: os.environ[key] for key in ("PATH", "HOME")}
        os.environ.update(PATH=temp, HOME=temp)
        try:
            sources, results, _ = collect(args, today, thresholds)
        finally:
            os.environ.update(saved)
        check("сбой изолирован", sources["context"]["status"] == "failed" and "transcripts" in sources)

    if errors:
        print("selftest: НЕ пройдено:", "; ".join(errors))
        return 1
    print("selftest: ок")
    return 0


if __name__ == "__main__":
    sys.exit(main())
