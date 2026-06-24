"""Lightweight, stdlib-only repo map: a per-file outline of top-level
functions/classes (and class methods) under a directory tree, with optional
cross-file import tracking.

Modeled on Aider's repo map, scoped down to what this repo actually
needs: no tree-sitter, no multi-language support, no PageRank-style
ranking — just a flat listing with optional cross-file dependency lines,
parsed with the stdlib `ast` module, intended to give `coding-agent` a
quick orientation pass before it dives into unfamiliar code.
"""
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path
from typing import NamedTuple

_SKIP_DIR_NAMES = {"__pycache__", ".venv", "venv", ".git", "node_modules"}


def _is_skipped(path: Path, root: Path) -> bool:
    """Return True if any directory in path's path (relative to root,
    excluding the file itself) is hidden or in _SKIP_DIR_NAMES.
    """
    for part in path.relative_to(root).parts[:-1]:
        if part in _SKIP_DIR_NAMES or part.startswith("."):
            return True
    return False


def _iter_python_files(root: Path) -> list[Path]:
    """Return every .py file under root, skipping hidden/build/dependency
    directories, in a stable sorted order.
    """
    if root.is_file():
        return [root] if root.suffix == ".py" else []
    return sorted(
        p for p in root.rglob("*.py") if not _is_skipped(p, root)
    )


def _module_to_candidates(
    module: str, level: int, file_path: Path, root: Path, package_root: Path
) -> list[Path]:
    if level > 0:
        base = file_path.parent
        for _ in range(level - 1):
            base = base.parent
        parts = module.split(".") if module else []
    else:
        base = package_root
        parts = module.split(".")
    candidate = base.joinpath(*parts) if parts else base
    return [candidate.with_suffix(".py"), candidate / "__init__.py"]


def _collect_imports(
    path: Path,
    root: Path,
    known: set[Path],
    *,
    package_root: Path | None = None,
    _tree: ast.Module | None = None,
) -> list[Path]:
    if package_root is None:
        package_root = root
    if _tree is None:
        try:
            _tree = ast.parse(path.read_text())
        except SyntaxError:
            return []
    found: list[Path] = []
    for node in ast.walk(_tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                for c in _module_to_candidates(alias.name, 0, path, root, package_root):
                    if c in known:
                        found.append(c)
                        break
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module:
                for c in _module_to_candidates(module, node.level, path, root, package_root):
                    if c in known:
                        found.append(c)
                        break
            else:
                # `from . import name` — no module qualifier; each name is a
                # sibling module relative to the package directory.
                base = path.parent
                for _ in range(node.level - 1):
                    base = base.parent
                for alias in node.names:
                    sibling = base / f"{alias.name}.py"
                    if sibling in known:
                        found.append(sibling)
    return sorted(set(found))


def _outline_file(
    path: Path,
    include_methods: bool = True,
    deps: list[Path] | None = None,
    *,
    _tree: ast.Module | SyntaxError | None = None,
) -> str:
    """Build one file's outline: optional imports line, then top-level
    functions/classes with line numbers, plus one indent level of class
    methods unless include_methods is False. If the file doesn't parse,
    note it as skipped instead of raising.
    """
    if _tree is None:
        try:
            _tree = ast.parse(path.read_text())
        except SyntaxError as exc:
            _tree = exc
    if isinstance(_tree, SyntaxError):
        return f"{path} -- SKIPPED (syntax error: {_tree.msg}, line {_tree.lineno})"

    symbol_lines: list[str] = []
    for node in _tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            symbol_lines.append(f"  def {node.name}() -- line {node.lineno}")
        elif isinstance(node, ast.ClassDef):
            symbol_lines.append(f"  class {node.name}: -- line {node.lineno}")
            if include_methods:
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        symbol_lines.append(
                            f"    def {child.name}() -- line {child.lineno}"
                        )

    if not symbol_lines and deps is None:
        return f"{path} -- (no top-level functions or classes)"

    lines: list[str] = []
    if deps is not None:
        lines.append(
            f"  imports: {', '.join(str(d) for d in deps)}" if deps
            else "  imports: (none)"
        )
    lines.extend(symbol_lines)
    return f"{path}\n" + "\n".join(lines)


def build_repo_map(
    root: Path,
    include_methods: bool = True,
    show_deps: bool = False,
    package_root: Path | None = None,
) -> str:
    """Build the full repo map: one outline block per Python file found
    under root, joined with blank lines. Class methods are omitted when
    include_methods is False. When show_deps is True, each file's block
    includes an 'imports:' line listing the other repo files it imports
    from (stdlib and third-party imports are not shown). package_root
    overrides the base directory used to resolve absolute imports — defaults
    to root when not specified. Returns a placeholder string if no Python
    files are found.
    """
    files = _iter_python_files(root)
    if not files:
        return "(no Python files found)"

    if show_deps:
        known = set(files)
        trees: dict[Path, ast.Module | SyntaxError] = {}
        for f in files:
            try:
                trees[f] = ast.parse(f.read_text())
            except SyntaxError as exc:
                trees[f] = exc
        deps_map = {
            f: _collect_imports(
                f, root, known,
                package_root=package_root,
                _tree=trees[f] if isinstance(trees[f], ast.Module) else None,
            )
            for f in files
        }
        return "\n\n".join(
            _outline_file(f, include_methods, deps=deps_map[f], _tree=trees[f])
            for f in files
        )

    return "\n\n".join(_outline_file(f, include_methods) for f in files)


class Chunk(NamedTuple):
    """One function/method/class body, with its exact source text and line range."""

    file: str
    name: str
    kind: str  # "function" | "method" | "class"
    start_line: int
    end_line: int
    source: str


def _node_to_chunk(node: ast.AST, path: Path, source: str, kind: str) -> Chunk:
    segment = ast.get_source_segment(source, node) or ""
    return Chunk(
        file=str(path),
        name=getattr(node, "name", "<unknown>"),
        kind=kind,
        start_line=node.lineno,
        end_line=getattr(node, "end_lineno", node.lineno),
        source=segment,
    )


def extract_chunks(root: Path) -> list[Chunk]:
    """Return one Chunk per top-level function/class (and class method)
    under root, each carrying its exact source text and line range.

    This is the AST-level counterpart to build_repo_map()'s single-line
    `-- line N` signatures: where the repo map gives one line per symbol
    (cheap, good for orientation), a Chunk carries the symbol's *entire*
    body — the unit src.vector_index embeds for semantic search, since a
    full function body captures far more meaning than its signature alone.
    """
    chunks: list[Chunk] = []
    for path in _iter_python_files(root):
        try:
            source = path.read_text()
            tree = ast.parse(source)
        except SyntaxError:
            continue

        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                chunks.append(_node_to_chunk(node, path, source, "function"))
            elif isinstance(node, ast.ClassDef):
                chunks.append(_node_to_chunk(node, path, source, "class"))
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        chunks.append(_node_to_chunk(child, path, source, "method"))
    return chunks


def build_import_graph(root: Path, package_root: Path | None = None) -> dict[str, list[str]]:
    """Return {file: [files it imports from this repo]} for every Python
    file under root.

    Reuses the same import-resolution logic build_repo_map(show_deps=True)
    already relies on internally (_collect_imports) — exposed here as a
    standalone graph so callers can answer "what does X depend on?" and, by
    inverting it, "what depends on X?" without re-parsing the repo map's
    text format.
    """
    files = _iter_python_files(root)
    known = set(files)
    trees: dict[Path, ast.Module | SyntaxError] = {}
    for f in files:
        try:
            trees[f] = ast.parse(f.read_text())
        except SyntaxError as exc:
            trees[f] = exc

    graph: dict[str, list[str]] = {}
    for f in files:
        deps = _collect_imports(
            f, root, known,
            package_root=package_root,
            _tree=trees[f] if isinstance(trees[f], ast.Module) else None,
        )
        graph[str(f)] = [str(d) for d in deps]
    return graph


def find_callers(root: Path, function_name: str) -> list[tuple[str, int]]:
    """Return (file, line) for every call site of function_name under root.

    Best-effort, syntactic call-site detection — matches calls of the form
    `function_name(...)` or `obj.function_name(...)` by name only, with no
    type resolution. This deliberately answers a question pure lexical or
    embedding search cannot: "find every place that calls X" requires
    matching an exact identifier used as a call target, not just a string
    that happens to contain that name.
    """
    callers: list[tuple[str, int]] = []
    for path in _iter_python_files(root):
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            called_name: str | None = None
            if isinstance(func, ast.Name):
                called_name = func.id
            elif isinstance(func, ast.Attribute):
                called_name = func.attr
            if called_name == function_name:
                callers.append((str(path), node.lineno))
    return callers


def _merged_import_graph(root: Path) -> dict[str, list[str]]:
    """Python's import graph plus the TS/JS one, merged into one {file: [deps]} dict.

    Lets --depends-on/--dependents-of answer queries against either language
    without callers needing to know which graph a given file lives in.
    """
    from src.ts_map import build_ts_import_graph

    graph = build_import_graph(root)
    graph.update(build_ts_import_graph(root))
    return graph


def _resolve_queried_file(file_arg: str, root: Path, graph: dict[str, list[str]]) -> str | None:
    """Match a user-supplied file argument (relative or absolute) against a graph's keys."""
    candidate = Path(file_arg)
    if not candidate.is_absolute():
        candidate = root / file_arg
    candidate_str = str(candidate)
    if candidate_str in graph:
        return candidate_str
    resolved = str(candidate.resolve())
    for key in graph:
        if key == resolved or str(Path(key).resolve()) == resolved:
            return key
    return None


def main(argv: list[str] | None = None) -> None:
    """CLI entry point: print a repo map for a directory (or single file), or
    run one of the call-graph/dependency-graph query modes below.

    Usage:
        python -m src.repo_map [--no-methods] [--deps] [--package-root DIR] [--json] [path]
        python -m src.repo_map --callers <function_name> [path] [--json]
        python -m src.repo_map --depends-on <file> [path] [--json]
        python -m src.repo_map --dependents-of <file> [path] [--json]

    Defaults to the current directory if no path is given. Pass
    --no-methods to omit class methods, --deps to show cross-file imports,
    --package-root DIR to set the base for resolving absolute import names
    (defaults to path when not given), --json for machine-readable output.

    --callers prints every (file, line) call site of a function/method name
    (find_callers(), AST-based for Python). --depends-on/--dependents-of
    print a file's direct imports / direct importers respectively, using the
    merged Python + TS/JS import graph so either language's files resolve.
    --json output is always {"results": [...]} for these three modes, to
    match this package's existing convention (see vector_index.py's main()).
    """
    args = list(sys.argv[1:] if argv is None else argv)
    as_json = "--json" in args
    if as_json:
        args.remove("--json")

    for flag, handler in (
        ("--callers", _run_callers_mode),
        ("--depends-on", _run_depends_on_mode),
        ("--dependents-of", _run_dependents_of_mode),
    ):
        if flag in args:
            idx = args.index(flag)
            target = args[idx + 1] if idx + 1 < len(args) else ""
            del args[idx:idx + 2]
            root = Path(args[0]) if args else Path(".")
            handler(target, root, as_json)
            return

    include_methods = "--no-methods" not in args
    show_deps = "--deps" in args
    package_root: Path | None = None
    filtered: list[str] = []
    skip_next = False
    for i, a in enumerate(args):
        if skip_next:
            skip_next = False
            continue
        if a == "--package-root":
            if i + 1 < len(args):
                package_root = Path(args[i + 1])
                skip_next = True
        elif a not in ("--no-methods", "--deps"):
            filtered.append(a)
    root = Path(filtered[0]) if filtered else Path(".")
    print(build_repo_map(root, include_methods, show_deps, package_root))


def _run_callers_mode(function_name: str, root: Path, as_json: bool) -> None:
    py_callers = find_callers(root, function_name)
    from src.ts_map import find_ts_callers
    ts_callers = find_ts_callers(function_name, root)
    if as_json:
        py_results = [{"file": f, "line": ln} for f, ln in py_callers]
        print(json.dumps({"results": py_results + ts_callers}))
        return
    all_callers = [(f, ln) for f, ln in py_callers] + [(str(r["file"]), int(r["line"])) for r in ts_callers]
    if not all_callers:
        print(f"No call sites found for {function_name!r}.")
        return
    for f, ln in all_callers:
        print(f"  {f}:{ln}")


def _run_depends_on_mode(file_arg: str, root: Path, as_json: bool) -> None:
    graph = _merged_import_graph(root)
    key = _resolve_queried_file(file_arg, root, graph)
    deps = graph.get(key, []) if key else []
    if as_json:
        print(json.dumps({"results": deps}))
        return
    if not deps:
        print(f"{file_arg} has no resolved local dependencies.")
        return
    for d in deps:
        print(f"  {d}")


def _run_dependents_of_mode(file_arg: str, root: Path, as_json: bool) -> None:
    graph = _merged_import_graph(root)
    key = _resolve_queried_file(file_arg, root, graph)
    dependents = [f for f, deps in graph.items() if key in deps] if key else []
    if as_json:
        print(json.dumps({"results": sorted(dependents)}))
        return
    if not dependents:
        print(f"No files depend on {file_arg}.")
        return
    for d in sorted(dependents):
        print(f"  {d}")


if __name__ == "__main__":
    main()
