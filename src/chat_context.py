"""Thin CLI wrapper assembling chat/agent-ready context from hybrid search.

Calls into ``vector_index.py``'s ``hybrid_search()`` (no retrieval logic is
reimplemented here) and, for each hit, reads a small surrounding snippet
straight from the file on disk — the same idea as ``enrichResults()`` in
desktop/src/main/ipc/search.handlers.ts, reimplemented in Python so this is
callable directly (e.g. from autonomousAgent.ts via runPythonJson) without
round-tripping through Electron's IPC layer.

CLI
---
    python -m src.chat_context <query> <repo-root> [--json] [--max-snippets N]

Without --json: prints a human-readable list of hits. With --json: emits
``{query, results: [{file, line, snippet, score}]}``.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from src.vector_index import hybrid_search

_DEFAULT_MAX_SNIPPETS = 5
_SNIPPET_CONTEXT_LINES = 4
_LINE_NUMBER_RE = re.compile(r"-- line (\d+)")


def _extract_line_number(line: str) -> int | None:
    """Pull the `-- line N` suffix out of a repo-map display line, if present."""
    match = _LINE_NUMBER_RE.search(line)
    return int(match.group(1)) if match else None


def _read_snippet(file_path: str, line_no: int, context: int = _SNIPPET_CONTEXT_LINES) -> str:
    """Read up to `context` lines of surrounding source around line_no (1-indexed).

    Returns "" on any read failure (missing file, permissions, etc.) rather
    than raising — a snippet is a nice-to-have, not load-bearing.
    """
    try:
        lines = Path(file_path).read_text(encoding="utf-8").splitlines()
    except OSError:
        return ""
    start = max(0, line_no - 1 - context)
    end = min(len(lines), line_no + context)
    return "\n".join(lines[start:end])


def build_chat_context(repo_map: str, query: str, root: Path, max_snippets: int = _DEFAULT_MAX_SNIPPETS) -> dict:
    """Run hybrid_search over repo_map and enrich each hit with a code snippet.

    Returns the {query, results: [{file, line, snippet, score}]} dict shape
    shared by the CLI's --json output and any direct Python caller.
    """
    hits = hybrid_search(repo_map, query, top_k=max_snippets)
    results = []
    for score, file, line in hits:
        file = file.strip()
        line = line.strip()
        line_no = _extract_line_number(line)
        snippet = ""
        if line_no is not None:
            file_path = file if Path(file).is_absolute() else str(root / file)
            snippet = _read_snippet(file_path, line_no)
        results.append({
            "file": file,
            "line": line,
            "snippet": snippet,
            "score": round(score, 6),
        })
    return {"query": query, "results": results}


def main(argv: list[str] | None = None) -> None:
    """CLI: python -m src.chat_context <query> <repo-root> [--json] [--max-snippets N]

    Without --json: prints the query followed by each hit's file, line, and
    snippet. With --json: {query, results: [{file, line, snippet, score}]}.
    """
    from src.repo_map import build_repo_map

    args = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in args
    if as_json:
        args.remove("--json")

    max_snippets = _DEFAULT_MAX_SNIPPETS
    if "--max-snippets" in args:
        idx = args.index("--max-snippets")
        max_snippets = int(args[idx + 1])
        del args[idx:idx + 2]

    query = args[0] if args else ""
    root = Path(args[1]) if len(args) > 1 else Path(".")

    if not query:
        if as_json:
            print(json.dumps({"query": query, "results": []}))
        else:
            print("No query given.")
        return

    repo_map = build_repo_map(root)
    output = build_chat_context(repo_map, query, root, max_snippets=max_snippets)

    if as_json:
        print(json.dumps(output))
        return

    print(f"Context for: {output['query']}")
    if not output["results"]:
        print("No results.")
        return
    for result in output["results"]:
        print(f"  [{result['score']:.4f}] {result['file']} — {result['line']}")
        if result["snippet"]:
            for snippet_line in result["snippet"].splitlines():
                print(f"      {snippet_line}")


if __name__ == "__main__":
    main()
