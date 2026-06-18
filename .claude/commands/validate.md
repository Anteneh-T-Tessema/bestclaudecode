---
description: Delegate to the coding-agent subagent to run this project's verification (ruff + pytest) and report results.
argument-hint: [optional focus, e.g. a file or step]
---
Delegate this to the `coding-agent` subagent — don't run the checks
yourself, the point of this command is to exercise that subagent.

Ask it to run `.venv/bin/ruff check .` and `.venv/bin/pytest src/tests/ -q`
for this project (scoped to `$ARGUMENTS` if given), fix any failures it
finds, and report back a concise pass/fail summary. Use the `.venv/bin`
paths explicitly — bare `ruff`/`pytest` aren't reliable here (see
root `CLAUDE.md`).
