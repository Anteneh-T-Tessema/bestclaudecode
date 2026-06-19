# Step 23: Configurable eviction limit and atime reliability fallback

## What was built

**`src/cache_manager.py`** — added `_effective_atime(path)` helper that returns
`st_atime` when it differs from `st_mtime`, and falls back to `st_mtime` when
they are equal. On Linux filesystems mounted with `noatime` (and on macOS APFS
with access-time optimisation) the kernel never updates `st_atime`, so it
equals `st_mtime` for every file — making atime-based LRU meaningless. The
fallback at least distinguishes files written at different times.

**`src/cached_context.py`** — `get_cached_context()` gains a `max_cache_files`
keyword argument (default 50, matching the previous hardcoded value) that is
passed through to `evict_lru()` on every cache write. Callers can now set a
tighter bound (e.g. `max_cache_files=10` for CI environments) without touching
internal code.

**`src/tests/test_cache_manager.py`** — two new tests:
- `test_effective_atime_returns_atime_when_different_from_mtime` — patches
  `Path.stat()` to return `atime != mtime` and asserts atime is used.
- `test_effective_atime_falls_back_to_mtime_on_noatime` — patches `Path.stat()`
  with `atime == mtime` and asserts mtime is returned instead.
- `test_get_cached_context_respects_max_cache_files` — end-to-end: writes 3
  entries with `max_cache_files=2` and verifies only 2 remain after eviction.

## Why

The atime gap was documented in Step 21 as an open issue. On developer laptops
running macOS with APFS the bug is unlikely to matter (atimes are updated), but
on Linux CI boxes with SSDs mounted `noatime` (common for performance) all
cache files would have identical atimes and eviction order would be arbitrary.
The fix makes LRU work correctly on both.

The configurable limit was also a documented Step 21 gap: `get_cached_context`
hardcoded the `50` limit internally and callers had no way to tune it.

## What was verified

- 11 cache-manager tests pass (up from 8)
- Full suite: 84 tests, 0 failures
- `ruff check src` clean

## Deliberately left undone

The `_effective_atime` heuristic (atime == mtime → noatime) is a proxy, not a
definitive check. A more reliable approach would be to read `/proc/mounts` or
call `os.statvfs` and inspect mount flags, but that is Linux-only and adds
complexity that is not justified for a local cache tool.
