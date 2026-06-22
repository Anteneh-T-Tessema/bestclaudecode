# Step 38 — Auto-generated architecture doc (new capability beyond Cursor and Devin)

## What was built

**`src/arch_doc.py`** — AST-based architecture document generator that keeps
documentation in sync with the code automatically, closing a gap that both
Cursor and Devin leave open (both produce code; neither updates architecture
docs).

Key API:
- `FunctionInfo(name, lineno, summary)` / `ClassInfo(name, lineno, summary, methods)` / `ModuleInfo(...)`
- `analyze_module(path)` → `ModuleInfo | None` — walks the AST to extract:
  - Module docstring (first paragraph, whitespace-collapsed)
  - Public functions and classes (names starting with `_` excluded)
  - Public methods per class
  - `src.*` imports (cross-module dependency graph)
- `analyze_package(src_dir)` → `list[ModuleInfo]` — all `src/*.py` excluding `__init__.py`
- `format_arch_doc(modules, include_imports)` → Markdown with `### path` headers,
  function/class bullets with line numbers, import graph lines
- `generate_arch_doc(paths, src_dir, include_imports)` → full document (convenience wrapper)
- CLI: `python -m src.arch_doc [module-path ...] [--no-imports]`

**`src/tests/test_arch_doc.py`** — 30 tests covering docstring helpers,
module analysis (public/private filtering, class methods, imports, syntax
error handling), package analysis (init exclusion, empty dir), and all
formatting paths.

## Why

After an implement cycle the codebase changes but architecture docs rot
immediately. `--autodoc` in `/implement` runs this after the review passes and
commits an updated `docs/ARCHITECTURE.md` alongside the code change. The diff
is always accurate; there's no manual step.

## Test count after this step: 327
