# Step 13: Cross-file import tracking and `/parallel-review` live exercise

Two things happened in this step. The first was a planned feature: extending
`repo_map.py` to track which repo files each file imports from. The second was
using the new `/parallel-review` command to review the changes — providing the
first live evidence of the parallel agent fan-out pattern added in Step 12.

---

## Feature: `--deps` flag in `repo_map.py`

The Step 11 docs noted: "cross-file import tracking — the dependency graph part
of Aider's repo map — is not yet done." This step closes that gap.

### What it does

`build_repo_map(root, show_deps=True)` (CLI: `--deps`) adds an `imports:` line
to each file's block listing the other Python files in the repo that it imports
from. Stdlib and third-party imports are silently ignored — only intra-repo
dependencies appear.

Example output:

```
src/tests/test_repo_map.py
  imports: src/repo_map.py
  def test_lists_top_level_function_and_class_with_method() -- line 4
  def test_skips_unparseable_file_instead_of_raising() -- line 16
  ...

src/repo_map.py
  imports: (none)
  def _is_skipped() -- line 19
  def _iter_python_files() -- line 29
  ...
```

### How it works

Two new private helpers (both stdlib-only, no new dependencies):

`_module_to_candidates(module, level, file_path, root)` — converts a module
name + relative level to candidate filesystem paths. For absolute imports
(`level=0`), resolves relative to `root`. For relative imports (`level>0`),
walks up from the file's directory. Returns `[path.py, path/__init__.py]` as
candidates.

`_collect_imports(path, root, known)` — walks the AST of a single file and
calls `_module_to_candidates` for each `Import` and `ImportFrom` node. Returns
the subset of candidates that are in `known` (the set of all repo files). A
`SyntaxError` returns `[]` rather than raising.

The `from . import name` case (no module qualifier) is handled separately: each
name in the import list is resolved as a sibling file in the package directory.
This case was identified as a gap during the code review (see below) and fixed
before the step was committed.

### What was verified

20 tests pass:
- `test_deps_shows_local_import` — `from b import foo` in `a.py` makes `b.py`
  appear in `a.py`'s imports line (asserts the full absolute path, not just the
  filename substring)
- `test_deps_omits_stdlib_and_third_party_imports` — `import os; import sys`
  produces `imports: (none)` and neither `os` nor `sys` appears in the output
- `test_deps_off_by_default` — no `imports:` line without `show_deps=True`
- `test_deps_no_local_imports_shows_none` — file with no local imports shows
  `imports: (none)` rather than an empty line
- `test_deps_detects_relative_import_without_module_qualifier` — `from . import
  utils` correctly resolves `utils` as a sibling file; this test was added after
  the code review flagged this as a missing case
- `test_deps_main_flag_adds_imports_line` — `--deps` CLI flag produces output
  with `imports:` lines

---

## Live exercise: `/parallel-review` fan-out

Step 12 added `/parallel-review` and documented it as "design proven, execution
path not exercised." Step 13 provides the live evidence.

### What actually ran

Two `code-reviewer` Agent calls were launched in a single response (parallel),
scoped to the diffs for `src/repo_map.py` and `src/tests/test_repo_map.py`
respectively. Both ran concurrently and reported back independently.

### Aggregated verdict: 0 Blocking, 4 Should-fix, 4 Nits across 2 files

**Should-fix findings (all addressed before commit):**

| File | Finding | Resolution |
|---|---|---|
| `repo_map.py:69-74` | `from . import name` (no module qualifier) silently misses deps | Fixed: added sibling-resolution branch in `_collect_imports` |
| `repo_map.py:113-114` | Placeholder `(no top-level functions or classes)` is dead code when `show_deps=True` because the imports header always populates `lines` first | Fixed: split symbol tracking into `symbol_lines`; check `not symbol_lines and deps is None` before appending the header |
| `test_repo_map.py:115` | `assert "b.py" in output` matches the absolute path tail accidentally — passes even if format changes | Fixed: asserts `str(tmp_path / "b.py") in output` |
| `test_repo_map.py:118-123` | Stdlib test asserts `(none)` appears but never asserts `os` and `sys` are absent | Fixed: added `assert "os" not in output` and `assert "sys" not in output` |

**Nit findings (not addressed — judgment call):**

- `_module_to_candidates` and `_collect_imports` have no docstrings — exempt by
  `src/CLAUDE.md` rule (underscore-prefixed names) but have non-obvious logic
- `show_deps=True` parses each file twice (once for imports, once for outline) —
  negligible at this repo's scale; premature to optimize
- Test assertions could more precisely distinguish which file's block a finding
  belongs to; left as-is because the broader test suite makes the behavior clear

### What the live run confirmed

- `/parallel-review` correctly fans out two `code-reviewer` instances in
  parallel — both ran and reported independently without interference.
- Aggregation (sorting by severity, tagging by file) worked correctly by hand
  in this step; the command file's aggregation spec is design-only (the
  assistant does the aggregation, there is no code).
- The Should-fix findings were real and actionable — the code review loop (fan
  out → aggregate → fix) produced net improvements to the implementation.

---

## Honest gaps remaining after Step 13

1. The dep-resolution logic assumes `root` is the project root for absolute
   imports. `import src.repo_map` works when `root` is the repo root; `import
   repo_map` works when `root=src/`. This assumption is undocumented and would
   silently underreport deps if a caller passes the wrong root.
2. `git rm`'d files (deleted from tracking, still on disk) remain invisible to
   the untracked-file fallback added in Step 12 — noted in docs/12 as a known
   gap, still unaddressed.
3. The double-parse (imports pass + outline pass) is a Nit now; becomes a
   Should-fix if the tool is ever pointed at a large codebase.
