# Step 21: LRU cache eviction and placeholder token fix

Two changes, both closing documented gaps from Step 20.

1. **Placeholder token fix** — `get_cached_context` now passes the real task
   to `format_context` when `task_filter=True` instead of the string
   `"__placeholder__"`, eliminating the risk of `"placeholder"` tokens
   matching real identifiers during filtering (gap 3).
2. **LRU cache eviction** — `src/cache_manager.py` keeps `.context-cache/`
   bounded at 50 files (configurable) by deleting the least-recently-accessed
   entries after each write (gap 2).

---

## Placeholder token fix

### The bug

`get_cached_context` built the orientation block by calling:

```python
format_context(root, "__placeholder__", ..., task_filter=task_filter)
```

When `task_filter=True`, `format_context` calls `filter_map(raw_map, task)`.
`filter_map` tokenises `"__placeholder__"` → `{"placeholder"}` and uses that
as the match criterion. Any file or symbol whose name contained the token
`"placeholder"` would be included; anything else would be filtered out —
completely wrong.

In practice `"placeholder"` is unlikely to appear in real identifier names,
so this was a dormant bug. But it was a correctness issue: the cached
orientation was filtered by the wrong task.

### The fix

When `task_filter=True`, pass the real task to `format_context`:

```python
_build_task = task if task_filter else "__placeholder__"
full = format_context(root, _build_task, ..., task_filter=task_filter)
sep = f"\n\n---\n\n## Task\n\n{_build_task}"
orientation = full[: full.index(sep)] if sep in full else full
```

The separator is constructed from `_build_task`, so the split still works
correctly regardless of which string was used as the task placeholder. When
`task_filter=False` the behaviour is unchanged — `"__placeholder__"` is still
used and `filter_map` is never called (because `task_filter=False`).

---

## LRU cache eviction (src/cache_manager.py)

### The problem

Step 20 documented: "each unique task produces its own cache file when
`--filter` is set. On a codebase where users run many different tasks, the
`.context-cache/` directory will grow."

Without a bound, a developer who uses `/context-implement --filter --cached`
across a week of work would accumulate hundreds of files — one per distinct
task.

### Design

`cache_manager.py` exports two public functions:

```python
def evict_lru(cache_dir: Path, max_files: int = 50) -> list[Path]:
    ...

def cache_stats(cache_dir: Path) -> dict[str, int]:
    ...
```

**`evict_lru`** — sorts `.json` files in the cache directory by `st_atime`
(access time) ascending, then deletes any beyond `max_files`. Returns the
list of deleted paths.

**Access time as the LRU signal** — every cache read in `get_cached_context`
calls `cache_file.read_text()`, which updates the file's atime on most
filesystems. Every write sets atime to write time. So atime is a reliable
proxy for "most recently used" in this access pattern.

**`cache_stats`** — returns `{"total": N, "bytes": M}` for the cache directory.
Used by the CLI to report the state before and after eviction.

### Integration with get_cached_context

`evict_lru(cache_dir)` is called immediately after every cache write:

```python
cache_file.write_text(json.dumps({...}))
evict_lru(cache_dir)          # ← keeps directory bounded
return orientation + ...
```

It is not called on cache hits (no need — the hit doesn't add files).

### CLI

```bash
python -m src.cache_manager [--max N] [cache_dir]
```

Prints stats and evicts if over the limit. Default `--max 50`, default
`cache_dir` is `.context-cache/` in the current directory.

```
Cache: 52 files, 184320 bytes in .context-cache/
Evicted 2 LRU file(s) (keeping 50 most recent).
```

### Capacity choice: 50 files

50 is generous for typical use. A developer typically cycles through 5–10
distinct focused tasks before repeating one. 50 files means cached results
survive across many work sessions before any eviction occurs. On a
pathologically diverse workflow (a different task every call), the cache still
stays bounded at 50 × ~3 KB ≈ 150 KB — negligible.

### Tests (src/tests/test_cache_manager.py)

Nine tests:

| Test | What it verifies |
|---|---|
| `test_evict_lru_no_eviction_when_under_limit` | no files deleted when under limit |
| `test_evict_lru_removes_oldest_accessed` | the LRU file (lowest atime) is deleted |
| `test_evict_lru_keeps_exactly_max_files` | exactly max_files remain after eviction |
| `test_evict_lru_returns_empty_for_nonexistent_dir` | graceful on missing dir |
| `test_evict_lru_ignores_non_json_files` | `.txt` and other files are not evicted |
| `test_cache_stats_counts_json_files` | total and bytes are reported correctly |
| `test_cache_stats_zero_for_nonexistent_dir` | zeroes when dir absent |
| `test_evict_lru_triggered_by_get_cached_context` | end-to-end: 3 writes → evict to 2 |

71 tests total; all pass.

---

## Honest gaps remaining after Step 21

1. **Bare root form still not matched**: `"cache"` and `"caching"` don't share
   a stem because `"cache"` has no strippable suffix. Addressed in Step 20
   docs; still open. A small lookup table of common irregular pairs
   (`{"cache": "cach", "make": "mak"}`) would fix the most common cases.
2. **atime unreliable on some filesystems**: macOS APFS and some Linux mounts
   with `noatime` don't update atime on reads. On these systems the LRU
   ordering degrades to insertion order (all atimes equal write time). For a
   cache bounded at 50 files this is acceptable — the eviction still removes
   old entries, just not necessarily the truly least-recently-used ones.
3. **No configurable max via get_cached_context**: the eviction limit is
   hardcoded to `_DEFAULT_MAX = 50` when called from `get_cached_context`.
   A `max_cache_files` parameter would allow callers to tighten the bound.
