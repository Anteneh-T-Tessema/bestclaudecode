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
import json
import subprocess
from pathlib import Path

_TS_EXTENSIONS = frozenset({".ts", ".tsx", ".js", ".mjs", ".cjs"})
_RESOLVE_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs")

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
    # 1. Try to run the Node.js AST parser script
    script_path = Path(__file__).parent.parent / "desktop" / "scripts" / "ts_ast_parser.js"
    if script_path.exists():
        try:
            res = subprocess.run(
                ["node", str(script_path), str(root)],
                capture_output=True,
                text=True,
                check=True
            )
            data = json.loads(res.stdout)
            outlines = []
            for file_path, symbols in sorted(data.items()):
                if not symbols:
                    outlines.append(f"{file_path} -- (no top-level declarations)")
                else:
                    outlines.append(f"{file_path}\n" + "\n".join(symbols))
            if outlines:
                return "\n\n".join(outlines)
        except Exception:
            # Fall back to regex parser on failure
            pass

    # 2. Fallback to regex parser
    files = _iter_ts_files(root)
    if not files:
        return "(no TypeScript/JavaScript files found)"
    return "\n\n".join(_outline_ts_file(f) for f in files)


# Matches `import ... from '<path>'`, `import('<path>')`, and `require('<path>')` —
# the three forms that resolve to a real module specifier string. Bare named
# imports with no `from` (e.g. side-effect `import './x'`) are also covered
# since the path group is the same regardless of what precedes `from`.
_IMPORT_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"""\bfrom\s+['"]([^'"]+)['"]"""),
    re.compile(r"""\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)"""),
    re.compile(r"""\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)"""),
]


def _resolve_ts_import(spec: str, from_file: Path, root: Path, known_by_resolved: dict[Path, Path]) -> Path | None:
    """Resolve an import specifier to a file under root, or None if it doesn't point there.

    Only relative specifiers (./ or ../) are considered — bare package names
    (e.g. "react") are skipped the same way build_import_graph() skips stdlib
    and third-party imports for Python, since there's no node_modules
    resolution here, only this repo's own files. known_by_resolved maps each
    known file's resolved (absolute, symlink-free) path to its original form,
    so candidates built from from_file's resolved parent still match known
    entries regardless of whether root/from_file were given as relative or
    absolute paths.
    """
    if not (spec.startswith("./") or spec.startswith("../")):
        return None
    base = (from_file.resolve().parent / spec).resolve()
    candidates = [base.with_suffix(ext) for ext in _RESOLVE_EXTENSIONS]
    candidates.append(base)  # already has an explicit extension, e.g. "./x.ts"
    for ext in _RESOLVE_EXTENSIONS:
        candidates.append(base / f"index{ext}")
    for candidate in candidates:
        if candidate in known_by_resolved:
            return known_by_resolved[candidate]
    return None


def build_ts_import_graph(root: Path) -> dict[str, list[str]]:
    """Return {file: [files it imports from this repo]} for every TS/JS file under root.

    The TypeScript/JavaScript counterpart to repo_map.build_import_graph().
    Necessarily regex/string-based rather than a real parser (no ast module,
    and no tree-sitter dependency is in scope here) — matches `import ...
    from '<path>'`, `import('<path>')`, and `require('<path>')` statements,
    resolving relative specifiers (./ , ../) against common extensions and
    directory index files. Bare package imports (e.g. "react") are skipped,
    same as build_import_graph() skips stdlib/third-party imports for Python.
    """
    files = _iter_ts_files(root)
    known_by_resolved = {f.resolve(): f for f in files}
    graph: dict[str, list[str]] = {}
    for f in files:
        try:
            source = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            graph[str(f)] = []
            continue
        deps: set[Path] = set()
        for pattern in _IMPORT_PATTERNS:
            for match in pattern.finditer(source):
                resolved = _resolve_ts_import(match.group(1), f, root, known_by_resolved)
                if resolved is not None:
                    deps.add(resolved)
        graph[str(f)] = sorted(str(d) for d in deps)
    return graph


def find_ts_callers(name: str, root: Path) -> list[dict[str, object]]:
    """Find call sites of *name* in all TypeScript/JavaScript files under *root*.

    Uses a regex that matches ``name(`` and ``name<`` at word boundaries — covers
    the vast majority of call expressions without needing a full AST parser.
    Returns ``[{"file": str, "line": int}, ...]``, same shape as the Python
    AST-based results returned by ``find_callers()`` in repo_map.py.
    """
    pattern = re.compile(rf"\b{re.escape(name)}\s*[(<]")
    results: list[dict[str, object]] = []
    for f in _iter_ts_files(root):
        try:
            source = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for lineno, line in enumerate(source.splitlines(), start=1):
            if pattern.search(line):
                results.append({"file": str(f), "line": lineno})
    return results


def main(argv: list[str] | None = None) -> None:
    """CLI: python -m src.ts_map [path]

    Prints a repo map for all TS/JS files under path (default: current dir).
    """
    args = sys.argv[1:] if argv is None else argv
    root = Path(args[0]) if args else Path(".")
    print(build_ts_map(root))


if __name__ == "__main__":
    main()
