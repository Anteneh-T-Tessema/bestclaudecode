"""TypeScript / JavaScript repo map via regex.

Extracts top-level exported and non-exported declarations from .ts, .tsx,
.js, and .mjs files using regular expressions rather than a full AST parser.
This keeps the dependency footprint at zero (no tree-sitter, no npm packages)
while covering the declaration forms that appear in real codebases.

Recognised forms
----------------
  export function foo(         → function foo
  export async function foo(   → function foo
  export class Foo {           → class Foo
  export const foo = (         → const foo (arrow/assigned function)
  export const foo: Type =     → const foo (typed constant)
  export default function(     → default export (anonymous)
  export default class Foo {   → default export class
  function foo(                → function foo (non-exported)
  class Foo {                  → class Foo (non-exported)
  export type FooType =        → type FooType
  export interface Foo {       → interface Foo

The output format matches build_repo_map() so the two can be combined:

    src/mcp-servers/server.ts
      function handleRequest() -- line 12
      class Router: -- line 45

Integrated with build_repo_map() via the --lang flag in the CLI and the
include_ts parameter on the Python API.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

_TS_EXTENSIONS = frozenset({".ts", ".tsx", ".js", ".mjs", ".cjs"})

_SKIP_DIR_NAMES = {"__pycache__", ".venv", "venv", ".git", "node_modules", "dist", "build", ".next"}

# Ordered from most specific to least — first match wins per line.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("function",  re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]")),
    ("class",     re.compile(r"^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)\s*[{<(]")),
    ("interface", re.compile(r"^\s*(?:export\s+)?interface\s+(\w+)\s*[{<]")),
    ("type",      re.compile(r"^\s*(?:export\s+)?type\s+(\w+)\s*=")),
    ("const",     re.compile(r"^\s*(?:export\s+)?const\s+(\w+)\s*[=:]")),
    ("default",   re.compile(r"^\s*export\s+default\s+(?:async\s+)?(?:function|class)\b")),
]


def _is_skipped(path: Path, root: Path) -> bool:
    for part in path.relative_to(root).parts[:-1]:
        if part in _SKIP_DIR_NAMES or part.startswith("."):
            return True
    return False


def _iter_ts_files(root: Path) -> list[Path]:
    if root.is_file():
        return [root] if root.suffix in _TS_EXTENSIONS else []
    return sorted(
        p
        for p in root.rglob("*")
        if p.suffix in _TS_EXTENSIONS and p.is_file() and not _is_skipped(p, root)
    )


def _outline_ts_file(path: Path) -> str:
    """Return a repo-map-style outline for one TypeScript/JavaScript file.

    Each recognised declaration becomes an indented line with a line number,
    matching the format produced by _outline_file() in repo_map.py so the
    two outputs can be concatenated and fed to the same downstream consumers
    (TFIDFIndex, filter_map, format_context, etc.).
    """
    try:
        source = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return f"{path} -- SKIPPED (unreadable)"

    symbol_lines: list[str] = []
    for lineno, line in enumerate(source.splitlines(), start=1):
        for kind, pat in _PATTERNS:
            m = pat.match(line)
            if m:
                name = m.group(1) if m.lastindex else "default"
                if kind in ("function", "class"):
                    symbol_lines.append(f"  {kind} {name}() -- line {lineno}")
                elif kind == "default":
                    symbol_lines.append(f"  export default -- line {lineno}")
                else:
                    symbol_lines.append(f"  {kind} {name} -- line {lineno}")
                break  # only first matching pattern per line

    if not symbol_lines:
        return f"{path} -- (no top-level declarations)"

    return f"{path}\n" + "\n".join(symbol_lines)


def build_ts_map(root: Path) -> str:
    """Build a repo map for all TypeScript/JavaScript files under root.

    Returns a placeholder string if no TS/JS files are found. The output
    format is identical to build_repo_map() so the two can be joined with
    a blank line separator.
    """
    files = _iter_ts_files(root)
    if not files:
        return "(no TypeScript/JavaScript files found)"
    return "\n\n".join(_outline_ts_file(f) for f in files)


def main(argv: list[str] | None = None) -> None:
    """CLI: python -m src.ts_map [path]

    Prints a repo map for all TS/JS files under path (default: current dir).
    """
    args = sys.argv[1:] if argv is None else argv
    root = Path(args[0]) if args else Path(".")
    print(build_ts_map(root))


if __name__ == "__main__":
    main()
