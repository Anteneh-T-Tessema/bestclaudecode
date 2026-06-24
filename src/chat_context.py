"""Thin CLI wrapper assembling chat/agent-ready context from hybrid search.

Calls into ``vector_index.py``'s ``hybrid_search()`` (no retrieval logic is
reimplemented here) and, for each hit, reads a small surrounding snippet
straight from the file on disk — the same idea as ``enrichResults()`` in
desktop/src/main/ipc/search.handlers.ts, reimplemented in Python so this is
callable directly (e.g. from autonomousAgent.ts via runPythonJson) without
round-tripping through Electron's IPC layer.

Each hit is also cross-referenced against the decision log
(``vector_index.related_decisions()``) so callers can surface *why* a file
is shaped the way it is, not just what it is. It's additionally
cross-referenced against the call graph (``repo_map.find_callers()``) so
callers can surface *who else uses this*, not just what it is — the same
"Beyond Cursor" framing extended from decision-log lookups to structural
call-site lookups.

When a persistent (Qdrant-backed) index already exists for the repo,
``build_chat_context()`` prefers it over recomputing ``hybrid_search()`` in
memory — see ``--build-index`` below to populate one. This is a transparent
speedup: callers don't need to know or care which path served a given call.

CLI
---
    python -m src.chat_context <query> <repo-root> [--json] [--max-snippets N]
    python -m src.chat_context --build-index <repo-root> [--json]

Without --json: prints a human-readable list of hits. With --json: emits
``{query, results: [{file, line, snippet, score, related_decisions, callers}]}``.
``--build-index`` instead builds/refreshes the persistent index and emits
``{indexed, backend}``.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from src.repo_map import find_callers
from src.vector_index import (
    active_backend,
    build_persistent_index,
    hybrid_search,
    persistent_search,
    related_decisions,
)

_DEFAULT_MAX_SNIPPETS = 5
_SNIPPET_CONTEXT_LINES = 4
_MAX_CALLERS = 3
_LINE_NUMBER_RE = re.compile(r"-- line (\d+)")
_SYMBOL_NAME_RE = re.compile(r"(?:def|class)\s+(\w+)")


def _extract_line_number(line: str) -> int | None:
    """Pull the `-- line N` suffix out of a repo-map display line, if present."""
    match = _LINE_NUMBER_RE.search(line)
    return int(match.group(1)) if match else None


def _extract_symbol_name(line: str) -> str | None:
    """Pull the function/class name out of a repo-map display line, if present.

    Matches lines like "def hybrid_search() -- line 289" or "class Foo --
    line N" — the same display format _extract_line_number() reads the line
    number out of.
    """
    match = _SYMBOL_NAME_RE.search(line)
    return match.group(1) if match else None


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


def _search_hits(repo_map: str, query: str, root: Path, max_snippets: int) -> list[tuple[float, str, str]]:
    """Return (score, file, line) hits, preferring a persistent index over the in-memory path.

    persistent_search()'s doc_count is the cheap, pragmatic signal for "does a
    persistent index exist": 0 means there's nothing built yet (or it's empty),
    so callers fall back to hybrid_search() rather than getting zero results.
    """
    doc_count, hits = persistent_search(query, top_k=max_snippets, local_path=_local_index_path(root))
    if doc_count > 0:
        return hits
    return hybrid_search(repo_map, query, top_k=max_snippets)


def _local_index_path(root: Path) -> Path:
    """Default on-disk location of this repo's persistent vector index."""
    return Path(root) / ".cache" / "qdrant"


def build_chat_context(repo_map: str, query: str, root: Path, max_snippets: int = _DEFAULT_MAX_SNIPPETS) -> dict:
    """Run hybrid search (persistent index if one exists, else in-memory) and enrich each hit.

    Each hit is enriched with a surrounding code snippet, any related
    decision-log entries (vector_index.related_decisions(), at most once per
    unique file among the hits), and the hit's call sites elsewhere in the
    repo (repo_map.find_callers(), at most once per unique symbol name among
    the hits, capped to _MAX_CALLERS sites each) — empty if the hit's `line`
    isn't a "def foo() -- line N" / "class Foo -- line N" form or the symbol
    is never called. Returns the {query, results: [{file, line, snippet,
    score, related_decisions, callers}]} dict shape shared by the CLI's
    --json output and any direct Python caller.
    """
    hits = _search_hits(repo_map, query, root, max_snippets)
    decisions_by_file: dict[str, list[dict[str, object]]] = {}
    callers_by_name: dict[str, list[dict[str, object]]] = {}
    results = []
    for score, file, line in hits:
        file = file.strip()
        line = line.strip()
        line_no = _extract_line_number(line)
        snippet = ""
        if line_no is not None:
            file_path = file if Path(file).is_absolute() else str(root / file)
            snippet = _read_snippet(file_path, line_no)
        if file not in decisions_by_file:
            decisions_by_file[file] = related_decisions(file, top_k=2)
        symbol_name = _extract_symbol_name(line)
        if symbol_name and symbol_name not in callers_by_name:
            callers_by_name[symbol_name] = [
                {"file": f, "line": ln}
                for f, ln in find_callers(root, symbol_name)[:_MAX_CALLERS]
            ]
        results.append({
            "file": file,
            "line": line,
            "snippet": snippet,
            "score": round(score, 6),
            "related_decisions": decisions_by_file[file],
            "callers": callers_by_name.get(symbol_name, []) if symbol_name else [],
        })
    return {"query": query, "results": results}


def main(argv: list[str] | None = None) -> None:
    """CLI: python -m src.chat_context <query> <repo-root> [--json] [--max-snippets N]
            python -m src.chat_context --build-index <repo-root> [--json]

    Without --json: prints the query followed by each hit's file, line,
    snippet, any related decisions, and any callers. With --json:
    {query, results: [{file, line, snippet, score, related_decisions, callers}]}.
    --build-index instead builds the persistent index and emits {indexed, backend}.
    """
    from src.repo_map import build_repo_map

    args = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in args
    if as_json:
        args.remove("--json")

    build_index = "--build-index" in args
    if build_index:
        args.remove("--build-index")

    max_snippets = _DEFAULT_MAX_SNIPPETS
    if "--max-snippets" in args:
        idx = args.index("--max-snippets")
        max_snippets = int(args[idx + 1])
        del args[idx:idx + 2]

    if build_index:
        root = Path(args[0]) if args else Path(".")
        count = build_persistent_index(root, local_path=_local_index_path(root))
        if as_json:
            print(json.dumps({"indexed": count, "backend": active_backend()}))
        else:
            print(f"Indexed {count} chunks into the persistent vector store (backend: {active_backend()}).")
        return

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
        for decision in result["related_decisions"]:
            print(f"      related decision: \"{decision['task']}\" → {decision['verdict']}")
        if result["callers"]:
            sites = ", ".join(f"{c['file']}:{c['line']}" for c in result["callers"])
            print(f"      called from: {sites}")


if __name__ == "__main__":
    main()
