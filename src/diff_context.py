"""Git diff context injection for agent prompts.

Extends format_context() with a "Recent changes" block that shows what has
changed in the working tree or since a reference commit. This lets the agent
see *what changed* (concrete diff lines) alongside *what exists* (the repo
map orientation), eliminating the most common agent mistake: re-implementing
something that was already partially changed.

The diff is injected as a fenced block between the orientation and the task,
capped at max_diff_lines to avoid filling the context window on large diffs.

Recognised sources
------------------
  get_diff()           staged + unstaged changes relative to HEAD
  get_diff("HEAD~1")   changes since the previous commit
  get_diff("--cached") staged changes only (pre-commit review)

Used by /context-implement --diff and /implement when the caller passes a
reference; not cached because diffs change on every file write.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from src.context import format_context

_DEFAULT_MAX_DIFF_LINES = 150


def get_diff(
    ref: str = "HEAD",
    *,
    repo_root: Path | None = None,
    cached: bool = False,
) -> str:
    """Return the unified diff string for working-tree changes.

    Args:
        ref: git ref to diff against (default HEAD). Pass "HEAD~1" to see
             the most recent commit, or a branch/SHA for any other range.
        repo_root: directory to run git in (default: current directory).
        cached: if True, show only staged changes (equivalent to --cached).

    Returns:
        The raw unified diff string, or an empty string if git is not
        available, the directory is not a repo, or there are no changes.
    """
    cwd = str(repo_root) if repo_root else None
    cmd = ["git", "diff"]
    if cached:
        cmd.append("--cached")
    cmd.append(ref)
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=10,
        )
        return result.stdout
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return ""


def format_context_with_diff(
    root: Path,
    task: str,
    *,
    ref: str = "HEAD",
    cached: bool = False,
    include_deps: bool = False,
    package_root: Path | None = None,
    max_map_lines: int = 200,
    max_diff_lines: int = _DEFAULT_MAX_DIFF_LINES,
    task_filter: bool = False,
    include_ts: bool = False,
) -> str:
    """Return a full context prompt that includes a diff block after the repo map.

    The diff is placed between the orientation block and the task description
    so the agent reads: codebase layout → what changed → what to do. Diffs
    longer than max_diff_lines are truncated with a count note.

    Args:
        root: directory to scan for the repo map.
        task: task description (appended last).
        ref: git ref passed to get_diff().
        cached: if True, show only staged changes.
        include_deps: passed through to format_context().
        package_root: passed through to format_context().
        max_map_lines: cap on orientation block lines.
        max_diff_lines: cap on diff lines before truncation note.
        task_filter: filter orientation to task-relevant symbols.
        include_ts: include TypeScript/JS section in orientation.
    """
    # Build orientation + bare task placeholder.
    base = format_context(
        root,
        "",
        include_deps=include_deps,
        package_root=package_root,
        max_map_lines=max_map_lines,
        task_filter=task_filter,
        include_ts=include_ts,
    )
    # Strip the trailing empty task section to re-assemble in order.
    sep = "\n\n---\n\n## Task\n\n"
    orientation = base[: base.index(sep)] if sep in base else base

    diff_str = get_diff(ref, repo_root=root, cached=cached)
    diff_block = _format_diff_block(diff_str, max_diff_lines, ref=ref)

    return (
        orientation
        + (("\n\n" + diff_block) if diff_block else "")
        + sep
        + task
    )


def _format_diff_block(diff: str, max_lines: int, ref: str = "HEAD") -> str:
    """Return a labelled fenced block for the diff, or empty string if no diff."""
    if not diff.strip():
        return ""
    lines = diff.splitlines()
    truncated = len(lines) > max_lines
    trimmed = "\n".join(lines[:max_lines])
    if truncated:
        trimmed += f"\n... (diff truncated at {max_lines} lines; {len(lines) - max_lines} more)"
    return f"## Recent changes (git diff {ref})\n\n```diff\n{trimmed}\n```"


def main() -> None:
    """CLI: python -m src.diff_context [ref] [root]

    Prints the diff block for the working tree relative to ref.
    Defaults to HEAD and the current directory.
    """
    args = sys.argv[1:]
    ref = args[0] if args else "HEAD"
    root = Path(args[1]) if len(args) > 1 else Path(".")
    diff = get_diff(ref, repo_root=root)
    block = _format_diff_block(diff, _DEFAULT_MAX_DIFF_LINES, ref=ref)
    print(block if block else "(no changes)")


if __name__ == "__main__":
    main()
