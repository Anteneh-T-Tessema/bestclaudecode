---
description: Delegate to the coding-agent subagent to run this project's verification (ruff + pytest) and report results.
argument-hint: [optional focus, e.g. a file or step]
---
Delegate this to the `coding-agent` subagent — don't run the checks
yourself, the point of this command is to exercise that subagent.

Ask it to run `ruff check .` and `pytest src/tests/ -q` for this project
(scoped to `$ARGUMENTS` if given), fix any failures it finds, and report
back a concise pass/fail summary.
