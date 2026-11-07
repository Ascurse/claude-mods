---
name: publish-check
description: "Use before text leaves for a public place: a post, an article, a guide page, a README of a public repo. Checks it for leaks of employer details and NDA material. Triggers — \"проверь перед публикацией\", \"нет ли тут NDA\", \"can I publish this\"."
---

# publish-check — a leak check before publishing

```bash
python3 ~/.claude/skills/publish-check/scripts/check.py FILE...
```

One local stop-list pass plus the two NDA questions from the vault's `jev_shadow.py`; the file text goes to the Jev API. Long files are judged in chunks, each reported by its first line.

Exit codes: `0` no signal, `1` signal, `2` not checked. Exit 2 means the answer is unknown, and publishing waits until the check runs.

## Reading a signal

- A stop-list hit is a fact: quote the line.
- `leak` or `context` ≥ 0.5 is a prompt to read that chunk, and a person decides. Jev cannot tell the author's own tooling from the employer's: bead IDs, vault paths and personal measurements score high too.

For each signal, find the passage and name what in it is the employer's, or say that nothing is. Rewording is the author's call, and publishing stays a separate decision.

Exit 0 lowers the risk without clearing the text: the stop-list is short, and names outside it pass.
