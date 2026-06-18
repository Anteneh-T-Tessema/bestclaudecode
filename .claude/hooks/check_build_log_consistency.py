#!/usr/bin/env python3
"""Stop hook: blocks Claude from finishing a turn if README.md's Step
status checklist and docs/NN-*.md disagree about which steps are done.

This is the final validation layer in the Step 6/7/8 hook chain: the
PreToolUse/PostToolUse hooks (check_docstrings.py, check_src_change.py)
gate individual src/ file changes, but nothing previously caught the
build-log-specific mistake of checking a step's box without writing its
doc (or vice versa) — exactly the kind of inconsistency this whole repo
is meant to prevent in itself.

Mirrors the parsing rules in mcp-servers/build-log-server/src/index.ts
(parseReadmeStatus / listDocFiles) in Python, since this hook has no way
to invoke that TypeScript MCP server directly from a Stop hook.

Claude Code invokes this script when the assistant's turn is about to
end (per the Stop entry in .claude/settings.json), feeding it JSON on
stdin and reading its exit code to decide whether to allow the stop:
  - exit 0  -> allow Claude to stop
  - exit 2  -> block it; stderr text is shown to Claude as the reason

Reference: https://code.claude.com/docs/en/hooks
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
README_PATH = PROJECT_ROOT / "README.md"
DOCS_DIR = PROJECT_ROOT / "docs"

STATUS_LINE_RE = re.compile(r"^- \[( |x)\] Step (\d+): (.+)$")
DOC_FILE_RE = re.compile(r"^(\d+)-.+\.md$")


def parse_readme_status() -> dict[int, bool]:
    """Return {step number: done?} parsed from README.md's status checklist."""
    text = README_PATH.read_text(encoding="utf-8")
    steps = {}
    for line in text.splitlines():
        m = STATUS_LINE_RE.match(line)
        if m:
            steps[int(m.group(2))] = m.group(1) == "x"
    return steps


def list_doc_steps() -> set[int]:
    """Return the set of step numbers that have a docs/NN-*.md file."""
    if not DOCS_DIR.is_dir():
        return set()
    steps = set()
    for entry in DOCS_DIR.iterdir():
        m = DOC_FILE_RE.match(entry.name)
        if m:
            steps.add(int(m.group(1)))
    return steps


def find_inconsistencies() -> list[str]:
    """Compare README status against docs/ files and describe any mismatch.

    Returns [] if everything agrees, or if either source is unreadable —
    this hook only ever blocks on a confirmed mismatch, never on its own
    inability to check.
    """
    try:
        readme_steps = parse_readme_status()
        doc_steps = list_doc_steps()
    except OSError:
        return []

    problems = []
    for step, done in sorted(readme_steps.items()):
        if done and step not in doc_steps:
            problems.append(
                f"Step {step} is checked off in README.md but has no "
                f"docs/{step:02d}-*.md file."
            )
        if not done and step in doc_steps:
            problems.append(
                f"Step {step} has a docs/{step:02d}-*.md file but is not "
                f"checked off in README.md."
            )
    return problems


def main() -> None:
    """Entry point: read the Stop event from stdin, decide allow/block."""
    try:
        json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        pass  # payload isn't needed for this check; malformed input isn't fatal

    problems = find_inconsistencies()
    if problems:
        print(
            "Blocked: README.md's Step status checklist and docs/ are out "
            "of sync:\n- " + "\n- ".join(problems) +
            "\nFix the checklist or write the missing doc before finishing.",
            file=sys.stderr,
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
