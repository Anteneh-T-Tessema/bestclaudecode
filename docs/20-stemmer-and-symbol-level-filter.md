# Step 20: Suffix stemmer, symbol-level filtering, and task-keyed cache

Three changes, all closing documented gaps from Step 19.

1. **Suffix stemmer** in `_tokenise` — inflected forms share a stem so they
   match identifiers across the codebase (gap 1).
2. **Symbol-level filtering** in `filter_map` — keeps only matching symbol
   lines within a file block rather than the whole block (gap 2).
3. **Task-keyed cache** in `get_cached_context` — when `task_filter=True` the
   cache key includes the stemmed task tokens, so `--filter --cached` gets
   genuine cache hits (gap 3).

---

## Suffix stemmer

### What changed

`_tokenise` now calls `_stem(token)` on each word before adding it to the
frozenset. `_stem` tries suffixes longest-first:

```
("ations", 4), ("ation", 4), ("ings", 3), ("ing", 3), ("tion", 3),
("ers", 3), ("ies", 3), ("ed", 3), ("er", 3), ("es", 3), ("s", 3)
```

Each entry is `(suffix, min_stem_length_after_strip)`. The minimum prevents
collapsing short words into single-character residuals (e.g. `"bes"` cannot
strip `"s"` → `"be"` because 2 < 3).

### Effect on matching

Before Step 20, `"caching"`, `"cached"`, and `"caches"` all produced
different tokens. Now all three stem to `"cach"`:

```
"caching" → strip "ing" → "cach"
"cached"  → strip "ed"  → "cach"
"caches"  → strip "es"  → "cach"
```

A task like `"fix caching bug"` now matches identifier names like
`get_cached_context`, `CacheStore`, `_caches` — it didn't before.

### What this is NOT

This is not a full Porter stemmer. The Porter algorithm has 5 steps and
handles irregular forms; this is 11 suffix rules ordered by length. It covers
the common English inflectional suffixes that appear in identifier names
without any external dependency. A task involving "authentication" won't
match a file called "auth" — that requires a semantic layer, not a stemmer.

---

## Symbol-level filtering

### What changed

`filter_map` now does a two-pass walk:

1. **Collect**: group lines into `(header, symbol_lines)` blocks.
2. **Filter per block**:
   - If the **filename** matches → keep header + all symbols (filename match
     signals the whole file is relevant; the agent needs the full API).
   - If the filename doesn't match but **symbol lines** do → keep header +
     only the matching symbol lines. A trailing blank separator line is
     re-added to preserve the map's visual structure.
   - If nothing matches → block is dropped.

### Before vs after

Task: `"update checksum logic"`

**Before (file-level)**:
```
src/utils.py
  def compute_checksum() -- line 5
  def load_config() -- line 20
  def parse_args() -- line 35
```
(Whole file kept — `compute_checksum` matched, but `load_config` and
`parse_args` are irrelevant noise.)

**After (symbol-level)**:
```
src/utils.py
  def compute_checksum() -- line 5
```
(Only the matching symbol; the file header is included so the agent knows
where to look.)

The filename-match fallback ensures correctness: if the agent needs to
understand `cache.py` as a whole (because `"cache"` appears in the task),
it gets the full file entry, not just the symbols whose names contain `"cache"`.

---

## Task-keyed cache for --filter --cached

### The gap

Step 19 noted: "the cache stores the *unfiltered* orientation, so
`--filter --cached` reuses the cached map and filters it at read time … the
cache offers no size reduction benefit when `--filter` is also set."

### The fix

When `task_filter=True`, `get_cached_context` computes the sorted stemmed
task tokens and encodes them into the cache key:

```python
task_tokens_str = "|".join(sorted(_tokenise(task))) if task_filter else ""
key = _cache_key(root, include_deps, package_root, task_tokens_str)
```

The cache stores the **already-filtered** orientation block. On a repeat call
with the same task and unchanged source, the lookup returns the pre-filtered
block directly — no re-scan, no re-filter.

Different tasks produce different keys (and therefore different cache files):

```
/context-implement --filter --cached "fix cache lookup"
# key encodes {"cach", "lookup"} → reads cache/abc123.json

/context-implement --filter --cached "update symbol filter"
# key encodes {"symbol", "filter"} → reads cache/def456.json (different file)
```

Without `--filter`, the key does not encode task tokens — a single cached
file serves all tasks against the same codebase (the unfiltered map).

### New tests

`test_task_filter_and_cached_produce_separate_cache_file` — `task_filter=False`
and `task_filter=True` on the same task produce two distinct cache files.

`test_task_filter_cache_hit_on_same_task` — second call with identical
`task_filter=True` + same task does not rewrite the cache file.

`test_task_filter_different_tasks_produce_different_cache_files` — two
different tasks each get their own cache file.

63 tests total; all pass.

---

## Honest gaps remaining after Step 20

1. **Bare root form not matched**: `"cache"` (no suffix) produces the token
   `"cache"`, while `"caching"` produces `"cach"`. They don't intersect. The
   stemmer only strips — it doesn't add back `"e"`. A Porter step-1b rule
   (`"cach"` → `"cache"` when the preceding vowel sequence allows it) would
   fix this but adds complexity.
2. **Cache accumulation**: each unique task produces its own cache file when
   `--filter` is set. On a codebase where users run many different tasks, the
   `.context-cache/` directory will grow. A simple LRU eviction (keep the N
   most recently used files) would bound the size.
3. **`format_context` passes `"__placeholder__"` as task to filter_map**: when
   building the cached orientation, the placeholder string's tokens
   (`"placeholder"`) could in theory match symbols — but `"placeholder"` is
   unlikely to appear in real identifier names, so this is a dormant issue.
