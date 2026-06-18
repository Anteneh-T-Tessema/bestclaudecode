#!/usr/bin/env python3
"""PreToolUse hook: blocks Write/Edit calls that would leave a .py file
under src/ with a top-level function or class missing a docstring.

This enforces, deterministically, the rule src/CLAUDE.md has stated since
Step 2 ("Public functions/classes get docstrings... required here once
src/ starts accumulating real code") but had no enforcement mechanism for
until this hook existed.

Claude Code invokes this script for every Write/Edit tool call (per the
matcher in .claude/settings.json), feeding it JSON on stdin and reading
its exit code + stdout to decide whether to proceed:
  - exit 0  -> allow the tool call
  - exit 2  -> block it; stderr text is shown to Claude as the reason

Reference: https://code.claude.com/docs/en/hooks
"""
from __future__ import annotations

import ast
import json
import sys


def get_post_edit_content(tool_name: str, tool_input: dict) -> str | None:
    """Reconstruct what the file's content will be AFTER this tool call,
    well enough to run a docstring check against it.

    For Write, tool_input["content"] is the full new file content — exact.
    For Edit and MultiEdit, Claude Code's tool_input only contains the
    changed old_string/new_string pair(s), not the full resulting file —
    we don't have the pre-edit file content available to this hook, so we
    conservatively check whether the new_string snippet(s) themselves
    introduce a function/class definition, and if so, whether that
    snippet has a docstring. This catches the common case (adding a new
    function via Edit/MultiEdit) without needing to reconstruct the whole
    file.
    """
    if tool_name == "Write":
        return tool_input.get("content", "")
    if tool_name == "Edit":
        return tool_input.get("new_string", "")
    if tool_name == "MultiEdit":
        return "\n".join(e.get("new_string", "") for e in tool_input.get("edits", []))
    return None


def find_undocumented_defs(source: str) -> list[str]:
    """Parse source with ast and return names of top-level function/class
    definitions that lack a docstring. Returns [] if source doesn't parse
    (e.g. it's a partial Edit snippet, not a full valid module) — we only
    block on a confirmed violation, never on our own inability to parse.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    undocumented = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if node.name.startswith("_"):
                continue  # private/dunder defs aren't held to this rule
            if ast.get_docstring(node) is None:
                undocumented.append(node.name)
    return undocumented


def main() -> None:
    """Entry point: read the PreToolUse JSON event from stdin, decide
    allow/block, and exit accordingly.
    """
    try:
        event = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        sys.exit(0)  # malformed input — fail open, never block on our own error

    tool_name = event.get("tool_name", "")
    tool_input = event.get("tool_input", {})

    if tool_name not in ("Write", "Edit", "MultiEdit"):
        sys.exit(0)

    file_path = tool_input.get("file_path", "")
    if "/src/" not in file_path.replace("\\", "/") and not file_path.replace("\\", "/").startswith("src/"):
        sys.exit(0)  # not under src/ — rule doesn't apply
    if not file_path.endswith(".py"):
        sys.exit(0)
    if "/tests/" in file_path.replace("\\", "/"):
        sys.exit(0)  # test files aren't held to this rule (per test-writing skill scope)

    content = get_post_edit_content(tool_name, tool_input)
    if not content:
        sys.exit(0)

    undocumented = find_undocumented_defs(content)
    if undocumented:
        names = ", ".join(undocumented)
        print(
            f"Blocked: {file_path} would have undocumented top-level "
            f"def(s)/class(es) without a docstring: {names}. "
            f"src/CLAUDE.md requires docstrings for public functions/classes "
            f"in src/. Add a docstring to each, or prefix the name with "
            f"'_' if it's intentionally private.",
            file=sys.stderr,
        )
        sys.exit(2)

    sys.exit(0)


if __name__ == "__main__":
    main()
