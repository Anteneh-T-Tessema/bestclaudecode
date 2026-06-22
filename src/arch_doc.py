"""Auto-generated architecture document from live source analysis.

After each implement cycle the codebase changes. Cursor and Devin both lack a
built-in mechanism to keep architecture documentation in sync with the code —
developers write docs manually or not at all. This module closes that gap by
extracting structure directly from the Python AST:

  - Module docstring (first paragraph only, to keep the doc concise)
  - Public functions and classes with their one-line docstring summaries
  - Import graph (which modules import which other src/ modules)

The output is a Markdown architecture overview that can be injected into agent
prompts (as an alternative to the repo map), committed alongside code, or
displayed in CI summaries.

This is intentionally lightweight — no type signatures, no external deps, no
full docstrings. The goal is a scannable map, not Sphinx-quality API docs.

CLI
---
    python -m src.arch_doc [module ...]

Without arguments, analyses every src/*.py module. With arguments, analyses
only the listed modules (by file path or module name like ``src.bm25_index``).
"""
from __future__ import annotations

import ast
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

_SRC_DIR = Path("src")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class FunctionInfo:
    """One public function or method."""

    name: str
    lineno: int
    summary: str   # first line of docstring, or ""


@dataclass
class ClassInfo:
    """One public class with its methods."""

    name: str
    lineno: int
    summary: str
    methods: list[FunctionInfo] = field(default_factory=list)


@dataclass
class ModuleInfo:
    """Parsed architecture info for one Python module."""

    path: Path
    module_name: str
    summary: str              # first paragraph of module docstring
    functions: list[FunctionInfo] = field(default_factory=list)
    classes: list[ClassInfo] = field(default_factory=list)
    imports: list[str] = field(default_factory=list)  # src.* imports only


# ---------------------------------------------------------------------------
# AST analysis
# ---------------------------------------------------------------------------

def _first_line(docstring: str | None) -> str:
    if not docstring:
        return ""
    return docstring.strip().splitlines()[0].strip()


def _first_paragraph(docstring: str | None) -> str:
    if not docstring:
        return ""
    paragraphs = re.split(r"\n\s*\n", docstring.strip(), maxsplit=1)
    return paragraphs[0].strip().replace("\n", " ")


def analyze_module(path: Path) -> ModuleInfo | None:
    """Parse one Python file and return its ModuleInfo, or None on error."""
    try:
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source, filename=str(path))
    except (OSError, SyntaxError):
        return None

    module_name = str(path).replace("/", ".").removesuffix(".py")
    summary = _first_paragraph(ast.get_docstring(tree))

    functions: list[FunctionInfo] = []
    classes: list[ClassInfo] = []
    imports: list[str] = []

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith("src."):
                    imports.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.module.startswith("src."):
                imports.append(node.module)

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if not node.name.startswith("_"):
                functions.append(FunctionInfo(
                    name=node.name,
                    lineno=node.lineno,
                    summary=_first_line(ast.get_docstring(node)),
                ))
        elif isinstance(node, ast.ClassDef):
            if not node.name.startswith("_"):
                methods: list[FunctionInfo] = []
                for item in node.body:
                    if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        if not item.name.startswith("_"):
                            methods.append(FunctionInfo(
                                name=item.name,
                                lineno=item.lineno,
                                summary=_first_line(ast.get_docstring(item)),
                            ))
                classes.append(ClassInfo(
                    name=node.name,
                    lineno=node.lineno,
                    summary=_first_line(ast.get_docstring(node)),
                    methods=methods,
                ))

    return ModuleInfo(
        path=path,
        module_name=module_name,
        summary=summary,
        functions=functions,
        classes=classes,
        imports=sorted(set(imports)),
    )


def analyze_package(src_dir: Path | None = None) -> list[ModuleInfo]:
    """Analyse all src/*.py modules (excluding __init__ and tests/).

    Returns a list of ModuleInfo, one per file, sorted by path.
    """
    root = src_dir or _SRC_DIR
    paths = sorted(p for p in root.glob("*.py") if p.name != "__init__.py")
    result: list[ModuleInfo] = []
    for p in paths:
        info = analyze_module(p)
        if info:
            result.append(info)
    return result


# ---------------------------------------------------------------------------
# Formatting
# ---------------------------------------------------------------------------

def format_arch_doc(modules: list[ModuleInfo], *, include_imports: bool = True) -> str:
    """Return a Markdown architecture overview for the given modules."""
    if not modules:
        return "## Architecture\n\n(no modules found)\n"

    lines: list[str] = ["## Architecture overview (auto-generated)\n"]

    for m in modules:
        lines.append(f"### `{m.path}`")
        if m.summary:
            lines.append(f"{m.summary}\n")

        for fn in m.functions:
            summary = f" — {fn.summary}" if fn.summary else ""
            lines.append(f"  - `{fn.name}()` line {fn.lineno}{summary}")

        for cls in m.classes:
            summary = f" — {cls.summary}" if cls.summary else ""
            lines.append(f"  - `class {cls.name}` line {cls.lineno}{summary}")
            for method in cls.methods:
                m_summary = f" — {method.summary}" if method.summary else ""
                lines.append(f"      - `.{method.name}()` line {method.lineno}{m_summary}")

        if include_imports and m.imports:
            lines.append(f"  - imports: {', '.join(m.imports)}")

        lines.append("")

    return "\n".join(lines)


def generate_arch_doc(
    paths: list[Path] | None = None,
    *,
    src_dir: Path | None = None,
    include_imports: bool = True,
) -> str:
    """Analyse modules and return a formatted architecture document.

    Args:
        paths: specific files to analyse. If None, analyses all src/*.py.
        src_dir: override the src/ directory (used in tests).
        include_imports: whether to include the import graph lines.
    """
    if paths:
        modules = [m for p in paths if (m := analyze_module(p)) is not None]
    else:
        modules = analyze_package(src_dir)
    return format_arch_doc(modules, include_imports=include_imports)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    """CLI: python -m src.arch_doc [--json] [--no-imports] [module-path ...]"""
    import json as _json

    args = sys.argv[1:]
    as_json = "--json" in args
    include_imports = "--no-imports" not in args
    args = [a for a in args if a not in ("--json", "--no-imports")]

    if args:
        paths = [Path(a.replace(".", "/").rstrip("/") + ".py") if not a.endswith(".py") else Path(a) for a in args]
        modules = [m for p in paths if (m := analyze_module(p)) is not None]
    else:
        modules = analyze_package()

    if as_json:
        def _fn(f: FunctionInfo) -> dict:
            return {"name": f.name, "lineno": f.lineno, "summary": f.summary}

        def _cls(c: ClassInfo) -> dict:
            return {"name": c.name, "lineno": c.lineno, "summary": c.summary, "methods": [_fn(meth) for meth in c.methods]}

        payload = {
            "modules": [
                {
                    "path": str(m.path),
                    "module_name": m.module_name,
                    "summary": m.summary,
                    "functions": [_fn(f) for f in m.functions],
                    "classes": [_cls(c) for c in m.classes],
                    "imports": m.imports,
                }
                for m in modules
            ],
            "markdown": format_arch_doc(modules, include_imports=include_imports),
        }
        print(_json.dumps(payload))
    else:
        print(format_arch_doc(modules, include_imports=include_imports))


if __name__ == "__main__":
    main()
