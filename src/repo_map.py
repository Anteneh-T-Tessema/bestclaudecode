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
import sys
from pathlib import Path

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


def main(argv: list[str] | None = None) -> None:
    """CLI entry point: print a repo map for a directory (or single file).

    Usage: python -m src.repo_map [--no-methods] [--deps] [path]
    Defaults to the current directory if no path is given. Pass
    --no-methods to omit class methods, --deps to show cross-file imports.
    """
    args = sys.argv[1:] if argv is None else argv
    include_methods = "--no-methods" not in args
    show_deps = "--deps" in args
    positional = [a for a in args if a not in ("--no-methods", "--deps")]
    root = Path(positional[0]) if positional else Path(".")
    print(build_repo_map(root, include_methods, show_deps))


if __name__ == "__main__":
    main()
