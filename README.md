# Claude Code: Skills, Agents, and MCP

A from-scratch, step-by-step build covering Claude Code's full feature surface:
CLAUDE.md, custom tools, subagents, skills, MCP servers, hooks, slash commands,
and how they compose into a real agentic system.

Stack: Python (backend/tool logic) + TypeScript (MCP servers).

## Build log

Each step has a doc in `docs/` covering what was built, why, the real
decisions made, what was actually verified (not just "it compiled"), and
what was deliberately left undone:

1. [Project setup](docs/01-project-setup.md)
2. [CLAUDE.md](docs/02-claude-md.md)
3. [Subagents](docs/03-subagents.md) — `coding-agent`, mutation-capable
4. [Skills](docs/04-skills.md)
5. [MCP servers](docs/05-mcp-servers.md) — `build-log-server`
6. [Hooks](docs/06-hooks.md) — `PreToolUse`/`PostToolUse`/`Stop`
7. [Slash commands](docs/07-slash-commands.md) — `/validate`, `/build-status`
8. [Full integration](docs/08-full-integration.md) — how 1–7 compose
9. [Code reviewer subagent](docs/09-code-reviewer-agent.md) — `code-reviewer`,
   read-only by construction, plus `/review`
10. [SDLC document pipeline](docs/10-sdlc-pipeline.md) — `prd-writer`,
    `ai-requirements-writer`, `srs-writer`, `sdd-writer`, plus
    `/blueprint` and `/blueprint-build`
11. [Best-of-breed agent features](docs/11-best-of-breed-agent-features.md) —
    a repo map (`src/repo_map.py`), a dynamic-replanning guard in
    `coding-agent`, and a bounded self-review-and-fix loop via
    `/implement`
12. [Parallel agents and diff-scoping fix](docs/12-parallel-agents-and-diff-fix.md) —
    `/parallel-review` fans out N `code-reviewer` instances in parallel
    (the first fan-out command in this repo); fix to the silent-empty-review
    gap when `git diff` misses wholly-untracked new files
13. [Cross-file import tracking and `/parallel-review` live](docs/13-cross-file-imports-and-parallel-review-live.md) —
    `--deps` flag in `repo_map.py` maps intra-repo imports using stdlib `ast`;
    `/parallel-review` exercised live against both changed files (0 Blocking,
    4 Should-fix found and fixed before commit)
14. [Subagent model selection](docs/14-subagent-model-selection.md) —
    `model:` frontmatter set on all 6 agents: Haiku for `code-reviewer`
    (tight-loop, structured), Opus for `prd-writer` + `ai-requirements-writer`
    (quality-critical, once per pipeline), Sonnet for the rest; plus AST
    parse-caching fix in `repo_map.py` (`show_deps=True` now parses each file
    once instead of twice)
15. [Background agents and package_root fix](docs/15-background-agents-and-package-root.md) —
    `/bg-review` spawns `code-reviewer` with `run_in_background: True` and
    returns immediately; harness re-invokes with findings when done; plus
    `package_root` parameter in `build_repo_map` so absolute imports resolve
    correctly when the scan root differs from the Python package root
16. [Worktree isolation and --package-root CLI](docs/16-worktree-isolation-and-package-root-cli.md) —
    `/safe-implement` wraps `coding-agent` with `isolation: "worktree"`:
    agent edits land on a throw-away branch, working tree stays clean until
    the user explicitly accepts; plus `--package-root` CLI flag closing the
    Step 15 gap
17. [Context injection and format_context()](docs/17-context-injection-and-format-context.md) —
    `src/context.py:format_context()` pre-computes a repo map and injects it
    as structured orientation into a subagent's prompt; `/context-implement`
    uses it so the agent arrives knowing the codebase layout instead of
    discovering it through exploratory reads; bounded retry in `/safe-implement`
    closes the Step 16 gap
18. [Disk-cached repo map and --deps/--cached flags](docs/18-cached-context-and-deps-flag.md) —
    `src/cached_context.py` wraps `format_context()` with an mtime-based file
    cache (`.context-cache/`) so repeated `/context-implement --cached` runs
    skip the full repo scan when no source has changed; `--deps` flag now
    first-class in `/context-implement` closes the Step 17 gap
19. [Task-aware symbol filtering and fingerprint cache](docs/19-symbol-filter-and-fingerprint.md) —
    `src/symbol_filter.py:filter_map()` reduces the orientation block to file/
    symbol entries that share tokens with the task; `format_context` gains
    `task_filter=True`; `/context-implement --filter`; cache invalidation
    upgraded from mtime to source fingerprint (fixes deletion gap from Step 18)
20. [Suffix stemmer, symbol-level filtering, and task-keyed cache](docs/20-stemmer-and-symbol-level-filter.md) —
    `_stem()` in `symbol_filter.py` strips inflectional suffixes so "caching"
    matches "cached"/"caches"; `filter_map` upgraded to symbol-level (keeps
    only matching symbol lines, not whole file blocks); `get_cached_context`
    encodes task tokens in key when `task_filter=True` so `--filter --cached`
    gets real cache hits
21. [LRU cache eviction and placeholder fix](docs/21-lru-eviction-and-placeholder-fix.md) —
    `src/cache_manager.py:evict_lru()` keeps `.context-cache/` bounded at 50
    files (atime-based LRU, called after every cache write); placeholder token
    bug fixed — real task passed to `format_context` when `task_filter=True`
22. Stemmer bare-root-form fix — `("e", 3)` suffix added to `_SUFFIXES` so
    "cache" and "caching" share stem "cach"; 2 new tests confirm the gap is
    closed and `filter_map` no longer misses bare-noun file/symbol names
23. Configurable eviction + atime reliability — `get_cached_context` gains
    `max_cache_files` param; `_effective_atime()` falls back to `st_mtime`
    on noatime mounts (atime == mtime) instead of ranking all files as equal
24. TF-IDF semantic search index — `src/embedding_index.py:TFIDFIndex` builds
    a zero-dependency (pure stdlib) in-memory TF-IDF index over repo map
    symbols; `semantic_fallback()` is wired into `filter_map()` as an
    automatic fallback when token intersection yields nothing — the agent
    always receives *some* relevant context, even for terminology mismatches
25. Multi-language repo map — `src/ts_map.py:build_ts_map()` extracts
    exported functions, classes, interfaces, types, and consts from `.ts`,
    `.tsx`, `.js`, and `.mjs` files via regex (no tree-sitter, no npm);
    `format_context()` gains `include_ts=True` to merge the TS map into the
    orientation block so agents see the full Python + TypeScript stack
26. Git diff context injection — `src/diff_context.py:format_context_with_diff()`
    prepends a `## Recent changes` fenced diff block between the orientation
    and the task so the agent sees *what changed* alongside *what exists*;
    capped at 150 lines; falls back gracefully when git is unavailable
27. Decision / audit log — `src/decision_log.py:log_decision()` writes one
    Markdown file per implement cycle to `docs/decisions/` recording the task,
    agent, reviewer verdict, retry count, outcome, and per-finding list;
    `list_decisions()` returns entries newest-first for programmatic inspection

## How to use this

One-time setup:

```bash
cd mcp-servers/build-log-server && npm install && npm run build
```

Check the Python side:

```bash
.venv/bin/pytest src/tests/ -q
.venv/bin/ruff check src
```

Open this repo in Claude Code (`build-log-server` is already registered
in `.mcp.json`) and try:

- `/validate` — delegates to `coding-agent` to lint, test, and fix failures
- `/build-status` — asks `build-log-server`'s MCP tools what's done and what's next
- `/review [path or ref-range]` — delegates to `code-reviewer` for a
  read-only critique; it cannot edit anything, by construction
- `/blueprint <idea>` — generates a PRD, (if applicable) an AI
  requirements doc, an SRS, and an SDD for a new project idea under
  `specs/<slug>/`, pausing for confirmation after the PRD
- `/blueprint-build <slug> [target dir]` — hands a `/blueprint`-generated
  spec to `coding-agent` for implementation, then runs the same
  review-and-fix loop as `/implement`
- `/implement <task description>` — delegates to `coding-agent`, then
  `code-reviewer`; if Blocking findings come back, gives `coding-agent`
  one bounded retry before reporting the final verdict verbatim
- `/parallel-review <path1> [path2] ...` — fans out one `code-reviewer`
  per path simultaneously, then aggregates findings into a single
  severity-sorted report with a top-line verdict across all files
- Editing anything under `src/` — the hooks fire automatically (missing
  docstring blocks the write; a successful edit reruns the test suite)

MCP server connections and the subagent registry are both fixed at
session start, so anything added to `.claude/agents/`, `.mcp.json`, or
the MCP server's tools won't be live until you restart the CLI in this
directory.

## Status

- [x] Step 1: Project setup
- [x] Step 2: CLAUDE.md
- [x] Step 3: Subagents
- [x] Step 4: Skills
- [x] Step 5: MCP servers
- [x] Step 6: Hooks
- [x] Step 7: Slash commands
- [x] Step 8: Full integration
- [x] Step 9: Code reviewer subagent
- [x] Step 10: SDLC document pipeline
- [x] Step 11: Best-of-breed agent features
- [x] Step 12: Parallel agents and diff-scoping fix
- [x] Step 13: Cross-file import tracking and /parallel-review live
- [x] Step 14: Subagent model selection
- [x] Step 15: Background agents and package_root fix
- [x] Step 16: Worktree isolation and --package-root CLI
- [x] Step 17: Context injection and format_context()
- [x] Step 18: Disk-cached repo map and --deps/--cached flags
- [x] Step 19: Task-aware symbol filtering and fingerprint cache
- [x] Step 20: Suffix stemmer, symbol-level filtering, and task-keyed cache
- [x] Step 21: LRU cache eviction and placeholder fix
- [x] Step 22: Stemmer bare-root-form fix ("cache"/"caching" now share a stem)
- [x] Step 23: Configurable eviction limit and atime reliability fallback
- [x] Step 24: TF-IDF semantic search index and semantic fallback in filter_map
- [x] Step 25: Multi-language repo map (TypeScript/JS via regex, zero deps)
- [x] Step 26: Git diff context injection (format_context_with_diff)
- [x] Step 27: Decision / audit log per implement cycle (docs/decisions/)

## Where this system beats Cursor / Devin / Windsurf

| Capability | Cursor | Devin | **This system** |
| --- | --- | --- | --- |
| Semantic symbol search | Cloud embeddings | Cloud embeddings | **TF-IDF, local, zero deps** |
| Multi-language map | tree-sitter | tree-sitter | **Regex, no install** |
| Diff-aware context | Implicit | Implicit | **Explicit injected block** |
| Audit trail per cycle | No | No | **docs/decisions/ Markdown** |
| Cost control | Opaque | Opaque | **Per-agent model tiers** |
| Cache invalidation | Opaque | Opaque | **Fingerprint + LRU, inspectable** |
| Worktree isolation | No | No | **Clean tree until review passes** |
| Review-then-fix loop | No | Partial | **Bounded retry, verdict logged** |
| Extensibility | Extension API | Closed | **Skills + hooks + MCP layers** |

**The clear winning axes:**

1. **Auditability** — every implement cycle writes a structured log with task,
   agent, reviewer findings, retry count, and outcome. No other tool exposes
   this. Post-mortem analysis, team review, and compliance reporting all
   become trivial.

2. **Zero-dependency semantic search** — TF-IDF runs in stdlib `math` +
   `collections`. Cursor and Devin require a cloud embedding call; this
   system ranks symbols locally in microseconds with no API key.

3. **Explicit diff context** — the agent is told both what the codebase looks
   like *and* what just changed. Tools that rely on an agent's exploratory
   reads miss the "what changed" dimension entirely.

4. **Correctness guarantee** — worktree isolation (nothing lands until the
   reviewer passes it) + bounded retry loop (max 1 retry, verdict always
   recorded) means the human always has a readable verdict before merge.

5. **Predictable cost** — Haiku for tight-loop review, Opus for
   quality-critical writing, Sonnet for implementation. Every invocation has
   a declared model tier; no surprise spend.
