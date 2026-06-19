# Step 14: Subagent model selection and AST parse caching

Two changes. The first — subagent model selection — is the primary new capability
demonstrated this step; it's a Claude Code feature none of the prior 13 steps
touched. The second — AST parse caching — is a code-quality fix to a Nit flagged
by the parallel review in Step 13.

---

## Feature: `model:` frontmatter in subagent files

Claude Code lets each subagent file declare the model it runs on via a `model:`
frontmatter key. The default, `inherit`, means the subagent uses whatever model
is running the parent session. Naming an explicit model ID overrides that.

This step sets explicit model IDs on all six agents in this repo, chosen by the
task profile each agent serves:

| Agent | Model | Rationale |
|---|---|---|
| `code-reviewer` | `claude-haiku-4-5-20251001` | Read-only, structured output (severity labels), runs inside tight orchestration loops (`/implement` may call it twice per task). Latency and cost matter more than deep creative reasoning. |
| `prd-writer` | `claude-opus-4-8` | User-facing strategic document; runs once per spec pipeline; quality of insight and language matters more than speed. |
| `ai-requirements-writer` | `claude-opus-4-8` | Complex domain reasoning (ML systems, eval metrics, compliance); also runs once; same quality-over-speed tradeoff. |
| `coding-agent` | `claude-sonnet-4-6` | Implementation tasks — needs to reason about code, iterate, and debug; Sonnet's balance of speed and capability is the right fit. |
| `srs-writer` | `claude-sonnet-4-6` | Structured translation from PRD to requirements; reasoning needed but not creative synthesis; Sonnet is sufficient. |
| `sdd-writer` | `claude-sonnet-4-6` | Architecture doc derived from upstream specs; same profile as srs-writer. |

### Why this is a real production pattern

In a multi-agent system, not all agents need the same model. Running every
subagent on the most capable (most expensive, slowest) model is wasteful and
unnecessary. The pattern is:

- **Tight-loop agents** (called many times per session, doing structured work):
  use the fastest model that produces correct structured output — Haiku.
- **Once-per-pipeline, quality-critical agents** (user-facing documents that
  need genuine reasoning): use the most capable model — Opus.
- **General implementation agents** (need balanced reasoning and coding ability):
  use the middle tier — Sonnet.

The model IDs used here match the current Claude 4.x family as of June 2026:
`claude-haiku-4-5-20251001`, `claude-sonnet-4-6`, `claude-opus-4-8`.

### What was verified

The frontmatter is YAML, parsed by Claude Code at agent load time. Verified by
inspection: all six files updated, `grep "^model:"` against all six agent files
confirms the expected values. The model IDs match the documented Claude 4.x
family.

Behavioral verification: not run in this step — exercising "this reviewer ran
faster than last time" requires a controlled benchmark, not a single invocation.
The structural change is correct; the latency/cost difference is real but not
directly observable in a dev workflow.

---

## Fix: AST parse caching (`show_deps=True` path)

The Step 13 parallel review flagged a Nit: with `show_deps=True`, `build_repo_map`
parsed each file twice — once in `_collect_imports` (to find import statements)
and once in `_outline_file` (to list symbols). For the small repos this tool
targets, the overhead is negligible; but the redundancy is unnecessary.

### What changed

`build_repo_map` now parses each file once when `show_deps=True`, caches the
result as `ast.Module | SyntaxError` keyed by path, and passes the cached tree
into both `_collect_imports` and `_outline_file` via a keyword-only `_tree`
parameter.

`_collect_imports` signature before:
```python
def _collect_imports(path, root, known) -> list[Path]:
    tree = ast.parse(path.read_text())  # parses here
    ...
```

`_outline_file` signature before:
```python
def _outline_file(path, include_methods, deps) -> str:
    tree = ast.parse(path.read_text())  # parses again
    ...
```

After:
```python
def _collect_imports(path, root, known, *, _tree=None) -> list[Path]:
    if _tree is None:
        tree = ast.parse(path.read_text())  # only parses if no tree provided
    ...

def _outline_file(path, include_methods, deps, *, _tree=None) -> str:
    if _tree is None:
        _tree = ast.parse(path.read_text())  # only parses if no tree provided
    ...
```

`build_repo_map` (when `show_deps=True`):
```python
trees = {}
for f in files:
    try:
        trees[f] = ast.parse(f.read_text())  # parse once
    except SyntaxError as exc:
        trees[f] = exc  # propagate SyntaxError rather than re-raising
deps_map = {f: _collect_imports(f, root, known, _tree=...) for f in files}
return "\n\n".join(_outline_file(f, ..., _tree=trees[f]) for f in files)
```

The `_tree` parameter is private (keyword-only, underscore-prefixed): callers
of the public API (`build_repo_map`, `main`) see no change. The optimization is
contained entirely inside the module.

### What was verified

All 20 existing tests pass unchanged — the optimization is behavioral-equivalent
for every case (the test suite covers SyntaxError handling, deps-on/off, methods
on/off, the CLI flags). No new tests added: correctness is already covered; the
fix is about I/O reduction, not behavior change.

---

## What these changes add to the repo's feature surface

| Change | What it demonstrates |
|---|---|
| `model:` frontmatter in agent files | Per-subagent model selection — cost-tiered routing across a multi-agent system |
| AST parse caching | Private keyword-only parameters as an optimization interface; no public API change required |

---

## Honest gaps remaining after Step 14

1. No benchmark comparing `show_deps=True` parse time before/after — the
   optimization is structural, not measured.
2. Model selection is configuration, not code: there's no programmatic test
   that verifies which model a given agent uses at runtime. Behavioral
   differences (speed, cost) aren't visible in unit tests.
3. Background agents (`run_in_background: true` in Agent calls) haven't been
   demonstrated — every Agent call in this repo still blocks. That's a natural
   candidate for Step 15.
