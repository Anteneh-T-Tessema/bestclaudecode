"""Web research context injection for agent prompts.

Cursor's @web feature lets the agent pull live documentation into its context
window before starting a task. This module provides the same capability as a
pre-compute step that runs before the coding-agent is invoked.

The output is a fenced Markdown block injected between the repo orientation
and the task, in the same style as the diff block from diff_context.py:

    ## Web research: <query>

    ```
    [Source 1 title]
    <snippet>

    [Source 2 title]
    <snippet>
    ```

Design
------
The fetcher is injected as a callable so the real implementation (which calls
a live search API) can be swapped for a mock in tests without monkey-patching
subprocess or network calls. The default fetcher is ``None``; callers that want
live results must pass ``fetcher=WebSearchFetcher()`` or supply their own.

The module is intentionally search-engine-agnostic: the fetcher protocol is
just ``Callable[[str], list[WebResult]]``, so any backend (Brave Search,
Tavily, DuckDuckGo, or a mock) works without changes to this module.

CLI
---
    python -m src.web_context <query>

Prints the formatted block. With no live fetcher wired in the CLI prints a
placeholder block explaining how to wire one in.
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Callable

_MAX_SNIPPET_LINES = 8
_MAX_RESULTS = 5


@dataclass
class WebResult:
    """One search result returned by a fetcher."""

    title: str
    url: str
    snippet: str


def format_web_block(results: list[WebResult], query: str) -> str:
    """Return a labelled fenced block for the web results, or a placeholder.

    Args:
        results: list of WebResult objects from any search backend.
        query: the original search query (used in the block header).
    """
    if not results:
        return (
            f"## Web research: {query}\n\n"
            "```\n(no results — fetcher returned empty list)\n```\n"
        )

    parts: list[str] = []
    for r in results[:_MAX_RESULTS]:
        snippet_lines = r.snippet.splitlines()[:_MAX_SNIPPET_LINES]
        snippet = "\n".join(snippet_lines)
        parts.append(f"[{r.title}]\n{r.url}\n{snippet}")

    body = "\n\n".join(parts)
    return f"## Web research: {query}\n\n```\n{body}\n```\n"


def fetch_web_context(
    query: str,
    *,
    fetcher: Callable[[str], list[WebResult]] | None = None,
    max_results: int = _MAX_RESULTS,
) -> str:
    """Fetch search results for query and return the formatted context block.

    Args:
        query: natural-language research query.
        fetcher: callable that accepts a query string and returns
            ``list[WebResult]``. Pass ``None`` to get a placeholder block
            that explains the missing fetcher (useful in tests and dry runs).
        max_results: cap on results passed to format_web_block.
    """
    if fetcher is None:
        return (
            f"## Web research: {query}\n\n"
            "```\n"
            "(web fetcher not configured — pass fetcher= to fetch_web_context)\n"
            "```\n"
        )

    results = fetcher(query)[:max_results]
    return format_web_block(results, query)


def parse_research_flag(args: list[str]) -> tuple[str, list[str]]:
    """Extract --research <query> from args, return (query, remaining_args).

    The query is everything after --research up to the next --flag or end.
    Returns ("", original_args) if --research is not present.

    Examples:
        ["--research", "BM25 algorithm", "--deps", "add search"]
        → ("BM25 algorithm", ["--deps", "add search"])

        ["add search"]
        → ("", ["add search"])
    """
    if "--research" not in args:
        return "", list(args)

    idx = args.index("--research")
    query_tokens: list[str] = []
    remaining: list[str] = args[:idx]
    i = idx + 1
    while i < len(args) and not args[i].startswith("--"):
        query_tokens.append(args[i])
        i += 1
    remaining.extend(args[i:])
    return " ".join(query_tokens), remaining


def main() -> None:
    """CLI: python -m src.web_context <query>

    Prints the formatted web research block. With no live fetcher the output
    explains how to wire one in.
    """
    query = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else ""
    if not query:
        print("Usage: python -m src.web_context <query>", file=sys.stderr)
        sys.exit(1)
    print(fetch_web_context(query))


if __name__ == "__main__":
    main()
