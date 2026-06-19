"""Lightweight, stdlib-only repo map: a per-file outline of top-level
functions/classes (and class methods) under a directory tree.

Modeled on Aider's repo map, scoped down to what this repo actually
needs: no tree-sitter, no multi-language support, no cross-file
dependency graph or PageRank-style ranking — just a flat listing,
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


def _outline_file(path: Path, include_methods: bool = True) -> str:
    """Build one file's outline: top-level functions/classes with line
    numbers, plus one indent level of class methods unless
    include_methods is False. If the file doesn't parse, note it as
    skipped instead of raising.
    """
    try:
        tree = ast.parse(path.read_text())
    except SyntaxError as exc:
        return f"{path} -- SKIPPED (syntax error: {exc.msg}, line {exc.lineno})"

    entries: list[str] = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            entries.append(f"  def {node.name}() -- line {node.lineno}")
        elif isinstance(node, ast.ClassDef):
            entries.append(f"  class {node.name}: -- line {node.lineno}")
            if include_methods:
                for child in node.body:
                    if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        entries.append(
                            f"    def {child.name}() -- line {child.lineno}"
                        )

    if not entries:
        return f"{path} -- (no top-level functions or classes)"
    return f"{path}\n" + "\n".join(entries)


def build_repo_map(root: Path, include_methods: bool = True) -> str:
    """Build the full repo map: one outline block per Python file found
    under root, joined with blank lines. Class methods are omitted when
    include_methods is False. Returns a placeholder string if no Python
    files are found.
    """
    files = _iter_python_files(root)
    if not files:
        return "(no Python files found)"
    return "\n\n".join(_outline_file(f, include_methods) for f in files)


def main(argv: list[str] | None = None) -> None:
    """CLI entry point: print a repo map for a directory (or single file).

    Usage: python -m src.repo_map [--no-methods] [path]
    Defaults to the current directory if no path is given. Pass
    --no-methods to omit class methods from the output.
    """
    args = sys.argv[1:] if argv is None else argv
    include_methods = "--no-methods" not in args
    positional = [a for a in args if a != "--no-methods"]
    root = Path(positional[0]) if positional else Path(".")
    print(build_repo_map(root, include_methods))


if __name__ == "__main__":
    main()
