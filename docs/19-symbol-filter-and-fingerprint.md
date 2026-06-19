# Step 19: Task-aware symbol filtering and fingerprint cache invalidation

Three changes. The primary new capability is **task-aware symbol filtering** —
`src/symbol_filter.py` reduces the orientation block to entries relevant to the
task so the agent receives a denser context on targeted work. The warmups close
two Step 18 gaps: the deletion-invalidation bug in the cache (replaced mtime
check with a source fingerprint) and the missing `--cached` column in
`/context-implement`'s comparison table.

---

## Warmup 1: fingerprint-based cache invalidation

Step 18 documented: "if a file is deleted, the map will still list it until
another file is modified" — because deleting a file does not raise the max
mtime of the survivors.

The fix replaces `_newest_py_mtime()` with `_source_fingerprint()`:

```python
def _source_fingerprint(root: Path) -> str:
    entries = sorted(
        (str(p.resolve()), p.stat().st_mtime, p.stat().st_size)
        for p in root.rglob("*.py") if p.is_file()
    )
    payload = json.dumps(entries, separators=(",", ":"))
    return hashlib.sha1(payload.encode()).hexdigest()
```

The fingerprint is stored in the cache JSON alongside the orientation block:

```json
{"fingerprint": "abc123...", "orientation": "## Repo orientation..."}
```

On load, the stored fingerprint is compared to the current one. Any
difference — addition, edit, rename, or deletion — invalidates the cache.
The old mtime approach only detected changes to *existing* files; the
fingerprint detects changes to the *set* of files.

### New tests for fingerprint behaviour

`test_cache_invalidated_when_file_deleted` — creates two files, caches, deletes
one, verifies the orientation block changes on the next call.

`test_source_fingerprint_changes_on_edit` — direct unit test on
`_source_fingerprint`.

`test_source_fingerprint_changes_on_deletion` — same for deletion.

`test_source_fingerprint_stable_when_unchanged` — same fingerprint on two
consecutive calls with no changes.

Also: `test_cache_file_is_valid_json` now asserts the `"fingerprint"` key is
present (it was absent in Step 18's cache format).

---

## Warmup 2: --cached column in /context-implement comparison table

Step 18 documented: "`--cached` not in `/context-implement`'s comparison table."

The table now has four columns:

| | `/implement` | `/context-implement` | `/context-implement --cached` |
|---|---|---|---|
| Agent knows repo layout | no | yes | yes |
| Map computation cost | none | one shell scan | zero on a hit |
| Stale if source unchanged | n/a | no | no |
| Correct on file deletion | n/a | yes | yes (fingerprint) |

---

## Feature: task-aware symbol filtering (src/symbol_filter.py)

### The problem

`format_context()` injects the full repo map — every file, every symbol. On a
large codebase, a task like "fix the cache invalidation bug" needs maybe 3
files out of 50. The other 47 files consume context window without helping.

`filter_map()` addresses this by keeping only the file blocks whose filename
or symbol names share at least one meaningful token with the task description.

### How it works

```python
def filter_map(repo_map: str, task: str) -> str:
```

1. Tokenise the task: split on word boundaries (`[A-Za-z][a-z0-9]*`),
   lowercase, drop stopwords (a curated ~40-word set), drop tokens shorter
   than 3 characters.
2. Walk the repo map line by line, grouping into file blocks (a file header
   line followed by its indented symbol lines).
3. For each block: if the filename or any symbol name contributes a token that
   intersects with the task tokens, keep the whole block.
4. If nothing matches, return the original map unchanged — an empty orientation
   is worse than an unfiltered one.

Token matching is intentionally simple: no embedding, no BM25, no semantic
similarity. It is O(n) with no external dependencies. A task like
`"context injection caching"` matches `context.py` and `cached_context.py`
but not `repo_map.py`.

### Why simple token matching

- Zero dependencies (stdlib only).
- Deterministic — same input always produces the same output.
- Fast — runs in microseconds on a 200-line map.
- Transparent — the user can predict what will be kept.

The documented gap (Step 17) mentioned "embed the task, retrieve top-k
symbols" as a future direction. Token matching is the prerequisite step:
it establishes the interface (`filter_map(map, task) -> map`) that a smarter
retriever could drop in behind later.

### Integration with format_context()

`format_context()` gains a `task_filter: bool = False` keyword argument:

```python
if task_filter and task:
    raw_map = filter_map(raw_map, task)
```

Filtering happens before the `max_map_lines` cap, so the cap applies to the
already-filtered (shorter) map. With `--filter`, the orientation block is
typically much smaller than `max_map_lines` even on large repos.

### --filter flag in /context-implement

`/context-implement --filter <task>` strips the flag, calls `format_context`
with `task_filter=True`, and proceeds normally. All three flags can be
combined: `--deps --cached --filter <task>`.

### Tests (src/tests/test_symbol_filter.py)

Ten tests:

| Test | What it verifies |
|---|---|
| `test_tokenise_splits_on_word_boundaries` | underscore-separated names split correctly |
| `test_tokenise_drops_stopwords` | stopwords excluded |
| `test_tokenise_drops_short_tokens` | tokens < 3 chars excluded |
| `test_filter_map_keeps_matching_file` | file with matching name kept, unrelated dropped |
| `test_filter_map_keeps_file_with_matching_symbol` | match on symbol name, not file name |
| `test_filter_map_returns_original_when_no_match` | fallback to full map |
| `test_filter_map_returns_original_for_empty_task` | empty task → no filtering |
| `test_filter_map_returns_original_for_all_stopword_task` | all-stopword task → no filtering |
| `test_filter_map_keeps_all_symbols_of_matching_file` | all symbols of a matched file kept |
| `test_filter_map_multiple_matches` | two matching files kept, one unrelated dropped |

53 tests total; all pass.

---

## Honest gaps remaining after Step 19

1. **Stemming is not applied**: "caching" matches files named "caching" but
   not "cache" or "cached". A simple suffix-strip (Porter stemmer or even just
   strip trailing `s`/`ed`/`ing`) would improve recall without adding
   dependencies.
2. **Symbol-level filtering vs. file-level**: the current implementation keeps
   or drops whole file blocks. A finer approach would keep only the matching
   symbol lines within a matched file — useful when a file has hundreds of
   symbols but only one is relevant.
3. **`--filter` interacts with `--cached`**: the cache stores the *unfiltered*
   orientation, so `--filter --cached` reuses the cached map and filters it
   at read time. This is correct but means the cache offers no size reduction
   benefit when `--filter` is also set — the full map is cached regardless.
4. **No live exercise of `--filter`**: same reason as prior steps — running it
   against this step's own diff would be circular.
