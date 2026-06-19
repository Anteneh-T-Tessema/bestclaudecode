"""Pre-computed context injection for agent prompts.

Produces a structured "repo orientation" block — a compact summary of
the codebase's file/symbol layout — intended to be prepended to an
agent's task prompt. The goal: the agent gets codebase orientation
without needing to read files exploratively before starting work,
reducing round-trips and keeping the useful part of the context window
for the actual task.

Used by the /context-implement orchestration command.
"""
from __future__ import annotations

from pathlib import Path

from src.repo_map import build_repo_map
from src.symbol_filter import filter_map
from src.ts_map import build_ts_map


def format_context(
    root: Path,
    task: str,
    *,
    include_deps: bool = False,
    package_root: Path | None = None,
    max_map_lines: int = 200,
    task_filter: bool = False,
    include_ts: bool = False,
) -> str:
    """Return a prompt string with a repo orientation header followed by task.

    The header is a trimmed repo map (capped at max_map_lines lines) wrapped
    in a labelled block so the agent can skim it quickly. The task description
    follows after a separator. Callers pass the result directly as the agent's
    prompt.

    Args:
        root: directory to scan (passed to build_repo_map).
        task: the task description to append after the orientation block.
        include_deps: if True, include cross-file import lines (--deps mode).
        package_root: override base for resolving absolute import names.
        max_map_lines: cap the map at this many lines before appending a
            truncation note — avoids blowing the context window on large repos.
        task_filter: if True, filter the map to entries whose names share
            tokens with the task before applying the line cap. This produces
            a denser, more relevant orientation for targeted tasks.
        include_ts: if True, append a TypeScript/JavaScript section from
            build_ts_map() so agents see the full stack (Python + TS/JS MCP
            servers, frontend code, etc.) in one orientation block.
    """
    raw_map = build_repo_map(root, show_deps=include_deps, package_root=package_root)
    if include_ts:
        ts_section = build_ts_map(root)
        if not ts_section.startswith("(no TypeScript"):
            raw_map = raw_map + "\n\n" + ts_section
    if task_filter and task:
        raw_map = filter_map(raw_map, task)
    lines = raw_map.splitlines()
    truncated = len(lines) > max_map_lines
    trimmed = "\n".join(lines[:max_map_lines])
    if truncated:
        trimmed += f"\n... (truncated at {max_map_lines} lines)"

    return (
        "## Repo orientation (auto-generated, read before starting)\n\n"
        f"```\n{trimmed}\n```\n\n"
        "---\n\n"
        f"## Task\n\n{task}"
    )
