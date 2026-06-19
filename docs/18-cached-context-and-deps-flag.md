# Step 18: Disk-cached repo map (--cached) and --deps flag in /context-implement

Two changes. The primary new capability is **disk-cached context injection** —
`src/cached_context.py` wraps `format_context()` with an mtime-based file
cache so repeated `/context-implement --cached` runs skip the repo scan when
no Python source has changed. The warmup closes the Step 17 documented gap:
`--deps` is now a first-class flag in `/context-implement`.

---

## Warmup: --deps flag in /context-implement

Step 17 documented: "The `--deps` flag is available in
`format_context(include_deps=True)` but not exposed as a
`/context-implement --deps` argument."

The fix adds a **Flags** section to `.claude/commands/context-implement.md`
before the Execution section. Both `--deps` and `--cached` are parsed by
stripping them from `$ARGUMENTS` before building the task text — a simple
prefix-strip approach rather than a full argument parser, matching the pattern
established for `--package-root` in Step 16. Unknown flags starting with `--`
pass through to the task text unchanged.

---

## Feature: disk-cached repo map (src/cached_context.py)

### The problem

Every `/context-implement` invocation calls `python -m src.repo_map`, which
walks the directory tree, parses every `.py` file with `ast`, and formats the
result. For a stable codebase (the common case between commits), this work is
redundant — the map is identical to the last run.

`cached_context.py` memoises the orientation block to disk so the scan runs
once and is reused until a source file changes.

### How the cache works

```
cache_dir = root / ".context-cache/"          (default; override in tests)
cache_key  = sha1(root | include_deps | package_root)[:16]
cache_file = cache_dir / "<key>.json"
```

**On a call to `get_cached_context(root, task, ...)`:**

1. Compute `source_mtime` = max mtime of all `*.py` files under `root`.
2. If `cache_file` exists and its mtime ≥ `source_mtime`: **cache hit**.
   - Read `{"orientation": "..."}` from the JSON file.
   - Append `\n\n---\n\n## Task\n\n<task>` and return.
3. Otherwise: **cache miss**.
   - Call `format_context(root, "__placeholder__", ...)`.
   - Split at the separator to extract just the orientation block.
   - Write `{"orientation": "..."}` to `cache_file`.
   - Return orientation + task.

The task is never stored in the cache — only the static orientation block is
persisted. Different task strings on the same codebase get the same cached
map, spliced with their individual task text at read time.

### Cache invalidation

Invalidation is conservative: any `.py` file newer than the cache triggers a
rebuild. This means:
- Adding a file → invalidates (new symbol appears in map).
- Editing a file → invalidates (symbols may change).
- Deleting a file → does NOT invalidate (mtime of remaining files unchanged).
  The next call will serve a stale map that still lists the deleted file.
  This is acceptable for an orientation block — the agent will discover the
  file is gone when it tries to read it.

### CLI usage

```bash
python -m src.cached_context [--deps] [root]
```

Prints the orientation block without a task section, so `/context-implement`
can capture it via shell substitution. The `--cached` flag in the slash
command calls this instead of `python -m src.repo_map`.

### Options hash → separate cache files

Each combination of `(root, include_deps, package_root)` gets its own JSON
file. Running `/context-implement --deps` and `/context-implement` on the same
codebase produces two cache files with different keys — they don't collide.

### Tests (src/tests/test_cached_context.py)

Nine tests, all new:

| Test | What it verifies |
|---|---|
| `test_get_cached_context_returns_orientation_and_task` | output has both section headers and the task |
| `test_cache_file_created_on_first_call` | cache dir contains a file after first run |
| `test_cache_hit_returns_same_orientation` | orientation block is identical on second call |
| `test_cache_hit_injects_new_task` | different task on second call is injected correctly |
| `test_cache_invalidated_when_source_changes` | orientation differs after source edit |
| `test_cache_not_invalidated_when_source_unchanged` | cache file mtime does not change on hit |
| `test_different_options_produce_different_cache_files` | `--deps` and no-deps get separate files |
| `test_cache_file_is_valid_json` | cache file is valid JSON with `"orientation"` key |
| `test_empty_repo_still_caches_and_returns` | graceful on empty tree |

39 tests total across the project; all pass.

---

## How /context-implement uses the two new flags together

```
/context-implement --deps --cached add a helper function to utils.py
```

1. Parse: `include_deps=True`, `use_cache=True`, task = "add a helper function to utils.py".
2. Run `python -m src.cached_context --deps` — returns cached map (or rebuilds).
3. Build orientation + task prompt.
4. Delegate to `coding-agent`.
5. Review-and-fix loop (unchanged from Step 17).

Without `--cached`, step 2 runs `python -m src.repo_map --deps` instead —
always fresh, never touches the cache.

---

## What .context-cache/ contains

`.context-cache/` is a local directory (add to `.gitignore`). Each file is a
small JSON object:

```json
{
  "orientation": "## Repo orientation (auto-generated, read before starting)\n\n```\n..."
}
```

The files are safe to delete — the next call rebuilds them. They contain no
secrets, no user data, and no task text.

---

## Honest gaps remaining after Step 18

1. **Deletion doesn't invalidate**: if a file is deleted, the map will still
   list it until another file is modified. For an orientation block this is a
   minor cosmetic issue (the agent discovers the missing file when it reads),
   but a content-hash-based cache key would be strictly correct.
2. **No TTL**: the cache never expires based on wall-clock time — only on
   source mtime. A repo cloned fresh will have all mtimes set to checkout
   time; the first call always rebuilds.
3. **`.context-cache/` not gitignored yet**: the directory should be in
   `.gitignore` to avoid committing cached map files. Not added in this step.
4. **`--cached` not in `/context-implement`'s comparison table**: the
   should-use guide in the command's doc doesn't yet distinguish between
   cached and uncached invocations.
