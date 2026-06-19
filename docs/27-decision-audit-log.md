# Step 27: Decision / audit log per implement cycle

## What was built

**`src/decision_log.py`** — structured per-cycle audit log:

- `log_decision(task, *, agent, verdict, retries, outcome, findings, docs_dir)`
  — writes one Markdown file to `docs/decisions/` (created if missing). The
  filename is `YYYY-MM-DD_HHMMSS_<slug>.md` where the slug is the first 40
  characters of the task, lowercased and hyphen-separated. The file contains:
  task title, agent name, reviewer verdict, retry count, one-line outcome, and
  an optional bulleted findings list.

- `list_decisions(docs_dir)` — returns all `*.md` files in `docs/decisions/`
  sorted newest-first (reverse lexicographic on the timestamp-prefixed names).

- `_slugify(text, max_len)` — filesystem-safe slug with collapsed hyphens and
  length cap.

- `_timestamp()` — UTC `YYYY-MM-DD_HHMMSS` string for filenames.

- CLI: `python -m src.decision_log --list [dir]` prints the 10 most recent
  entries; without `--list` writes a smoke-test entry.

**`src/tests/test_decision_log.py`** — 11 tests covering: slug normalisation,
special-char stripping, max-length truncation, hyphen collapsing, timestamp
format, file creation, content fields (task/verdict/retries), findings block,
default/custom agent, newest-first ordering, empty-dir edge case, nested
directory creation.

## Why

Cursor, Devin, and Windsurf all operate as black boxes: the developer sees the
final diff but not *why* a particular implementation path was chosen, how many
retries were needed, or what the reviewer flagged. This creates friction for:

- **Post-mortem analysis**: "why does this module keep getting review failures?"
- **Team review**: "what did the agent try before landing on this?"
- **Compliance/audit**: regulated environments require a record of automated
  changes.

The decision log is the primary "clear winner" differentiator for teams
operating in compliance-sensitive environments (fintech, healthcare, legal).

The Markdown format was chosen over JSON so entries are human-readable without
tooling and can be rendered by any docs viewer, included in PR descriptions, or
grepped for patterns.

## What was verified

- 11 new tests pass
- `list_decisions` returns entries newest-first confirmed by timestamp ordering
- Full suite: 123 tests, 0 failures
- `ruff check src` clean

## Deliberately left undone

- `/implement` does not yet call `log_decision()` automatically — the Python
  API is complete but the slash command integration requires updating
  `.claude/commands/implement.md`. That is a future step.
- No aggregation query (e.g. "count Blocking findings across the last 20 cycles")
  — the files are plain Markdown; a future MCP tool or simple grep serves this.
