#!/usr/bin/env python3
"""Классифицирует решение через Jev: спрашивать ли пользователя, ставки, категория, рекомендуемый вариант.

stdin:  {"situation": "...", "options": {"key": "что значит", ...}, "user_flagged_open": false}
        options — 0 или 2+; user_flagged_open — пользователь сам назвал вопрос открытым
stdout: {"action": "ask"|"proceed"|"fallback", "reasons": [...], ...}
"""
import json
import os
import subprocess
import sys

import yaml

DEFAULTS = {
    "ask_if_user_owned_at": 0.5,
    "ask_if_stakes_at": 0.6,
    "always_ask_categories": ["destructive", "outward"],
}

STAKES_LEVELS = [
    "Trivial: redo in minutes",
    "Moderate: some rework",
    "High: hard to reverse, costly, or affects other people",
]

CATEGORIES = {
    "scope": "what to build, include or leave out",
    "architecture": "structure, libraries, interfaces, data model",
    "destructive": "deleting, overwriting, force actions, data loss",
    "outward": "commit, push, send, publish, anything other people see",
    "taste": "style, naming, wording, visual design",
    "priority": "what to do first or next, what to drop",
}


def load_thresholds():
    # Проектный .claude/thresholds.yaml перекрывает глобальный
    merged = dict(DEFAULTS)
    for path in (os.path.expanduser("~/.claude/thresholds.yaml"), ".claude/thresholds.yaml"):
        try:
            with open(path) as f:
                merged.update((yaml.safe_load(f) or {}).get("decision_menu") or {})
        except (OSError, yaml.YAMLError):
            pass
    return merged


def build_request(situation, options):
    questions = [
        {"id": "user_owned", "type": "noul",
         "instructions": "This decision genuinely belongs to the person: it cannot be settled from the "
                         "request, the code or sensible defaults, or it is destructive, outward-facing "
                         "or irreversible"},
        {"id": "stakes", "type": "score", "instructions": "How costly is a wrong choice here?",
         "criteria": STAKES_LEVELS},
        {"id": "category", "type": "choice", "instructions": "What kind of decision is this?",
         "criteria": CATEGORIES},
    ]
    if len(options) >= 2:
        questions.append({"id": "recommended", "type": "choice",
                          "instructions": "Which option best fits the stated goal, the existing code "
                                          "and the person's known preferences?",
                          "criteria": options})
    return {"state": situation, "questions": questions}


def decide(answers, thresholds, user_flagged_open=False):
    """Чистая логика поверх ответов Jev — отдельно, чтобы тестировать без сети."""
    user_owned = answers["user_owned"]["noul"]
    # Jev отдаёт score как ожидаемый индекс уровня (0..len-1), приводим к 0..1
    stakes = answers["stakes"]["score"] / (len(STAKES_LEVELS) - 1)
    category = answers["category"]["choice"]
    reasons = []
    # Пользователь сам сказал «не уверен» — решение его, мнение Jev тут не решает
    if user_flagged_open:
        reasons.append("user_flagged_open")
    if category in thresholds["always_ask_categories"]:
        reasons.append(f"category:{category}")
    if user_owned >= thresholds["ask_if_user_owned_at"]:
        reasons.append(f"user_owned:{user_owned:.2f}")
    if stakes >= thresholds["ask_if_stakes_at"]:
        reasons.append(f"stakes:{stakes:.2f}")
    result = {
        "action": "ask" if reasons else "proceed",
        "reasons": reasons,
        "user_owned": user_owned,
        "stakes": round(stakes, 2),
        "category": category,
    }
    rec = answers.get("recommended")
    if rec:
        result["recommended"] = rec["choice"]
        result["recommended_confidence"] = rec.get("confidence")
    return result


def main():
    req = json.load(sys.stdin)
    situation = req.get("situation", "").strip()
    options = req.get("options") or {}
    if not situation or len(options) == 1:
        print(json.dumps({"action": "fallback", "reasons": ["bad_input: need situation and 0 or 2+ options"]}))
        return 2
    try:
        proc = subprocess.run(["jev", "ask"], input=json.dumps(build_request(situation, options)),
                              capture_output=True, text=True, timeout=30)
        answers = json.loads(proc.stdout)["answers"]
    except (OSError, subprocess.TimeoutExpired, ValueError, KeyError) as exc:
        # Jev недоступен — решает Claude сам по тем же правилам, см. SKILL.md
        print(json.dumps({"action": "fallback", "reasons": [f"jev_unavailable: {type(exc).__name__}"]}))
        return 0
    print(json.dumps(decide(answers, load_thresholds(), bool(req.get("user_flagged_open"))), ensure_ascii=False))
    return 0


def selftest():
    t = dict(DEFAULTS)

    def answers(owned, stakes, cat, rec=None):
        a = {"user_owned": {"noul": owned}, "stakes": {"score": stakes}, "category": {"choice": cat}}
        if rec:
            a["recommended"] = {"choice": rec, "confidence": 0.9}
        return a

    assert decide(answers(0.1, 0.2, "architecture", "rq"), t)["action"] == "proceed"
    assert decide(answers(0.1, 0.2, "architecture", "rq"), t)["recommended"] == "rq"
    assert decide(answers(0.1, 0.1, "destructive"), t)["action"] == "ask"
    assert decide(answers(0.1, 0.1, "outward"), t)["action"] == "ask"
    assert decide(answers(0.7, 0.1, "scope"), t)["action"] == "ask"
    assert decide(answers(0.1, 1.6, "taste"), t)["action"] == "ask"
    assert decide(answers(0.49, 1.18, "priority"), t)["action"] == "proceed"
    assert decide(answers(0.1, 0.1, "scope"), t, user_flagged_open=True)["action"] == "ask"
    req = build_request("s", {"a": "x", "b": "y"})
    assert [q["id"] for q in req["questions"]] == ["user_owned", "stakes", "category", "recommended"]
    assert len(build_request("s", {})["questions"]) == 3
    print("selftest ok")


if __name__ == "__main__":
    if sys.argv[1:] == ["--selftest"]:
        selftest()
    else:
        sys.exit(main())
