---
description: Delegate to the coding-agent subagent to run this project's verification (Python ruff/pytest + the MCP server's npm test) and report results.
argument-hint: [optional focus, e.g. a file or step]
---
Delegate this to the `coding-agent` subagent — don't run the checks
yourself, the point of this command is to exercise that subagent.

Ask it to run, and fix any failures it finds:

1. `.venv/bin/ruff check .` and `.venv/bin/pytest src/tests/ -q` for the
   Python side (scoped to `$ARGUMENTS` if given). Use the `.venv/bin`
   paths explicitly — bare `ruff`/`pytest` aren't reliable here (see
   root `CLAUDE.md`).
2. `npm test` in `mcp-servers/build-log-server/` for the MCP server side
   (builds, then runs its committed `node:test` suite).

Report back a concise pass/fail summary covering both.
