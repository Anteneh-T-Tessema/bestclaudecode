"""LRU eviction manager for the .context-cache/ directory.

When task_filter=True is used with get_cached_context(), each unique
task produces its own cache file (the task tokens are part of the key).
Without any bound, the cache directory grows unboundedly across sessions.

This module implements a simple LRU policy: keep the N most recently
accessed cache files, delete the rest. "Recently accessed" is defined by
the file's atime (access time) — updated on every read. Newly written files
have their atime set to write time, which makes them newer than any existing
hit that was last touched earlier.

Default capacity: 50 files. This is generous enough for normal use (a
developer typically runs 5–10 distinct tasks before the same task repeats)
while bounding the directory to a fixed size.

Called automatically by get_cached_context() after each cache write.
Also exposed as a CLI for manual inspection and pruning:

    python -m src.cache_manager [--max N] [cache_dir]
"""
from __future__ import annotations

import sys
from pathlib import Path

_DEFAULT_MAX = 50
_CACHE_DIR_NAME = ".context-cache"


def _effective_atime(path: Path) -> float:
    """Return the best available proxy for last-access time.

    On filesystems mounted with noatime (common on Linux SSDs and macOS APFS
    with optimised access), st_atime is never updated — it equals st_mtime or
    st_ctime and cannot be used to rank recency. In that case we fall back to
    st_mtime, which at least distinguishes files written at different times.
    """
    st = path.stat()
    if st.st_atime == st.st_mtime:
        return st.st_mtime
    return st.st_atime


def evict_lru(cache_dir: Path, max_files: int = _DEFAULT_MAX) -> list[Path]:
    """Delete the least-recently-accessed cache files that exceed max_files.

    Only .json files are considered (the cache format). Files are sorted by
    effective atime ascending (falls back to mtime on noatime mounts); any
    beyond the max_files most-recent are deleted.

    Returns the list of paths that were deleted (empty when no eviction needed).

    Args:
        cache_dir: the directory to manage.
        max_files: maximum number of .json files to keep.
    """
    if not cache_dir.exists():
        return []

    json_files = [p for p in cache_dir.iterdir() if p.suffix == ".json" and p.is_file()]
    if len(json_files) <= max_files:
        return []

    json_files.sort(key=_effective_atime)
    to_delete = json_files[: len(json_files) - max_files]
    for path in to_delete:
        path.unlink(missing_ok=True)
    return to_delete


def cache_stats(cache_dir: Path) -> dict[str, int]:
    """Return a summary of the cache directory state.

    Keys: "total" (file count), "bytes" (total size in bytes).
    Returns zeroes when the directory does not exist.
    """
    if not cache_dir.exists():
        return {"total": 0, "bytes": 0}
    files = [p for p in cache_dir.iterdir() if p.suffix == ".json" and p.is_file()]
    return {"total": len(files), "bytes": sum(p.stat().st_size for p in files)}


def main() -> None:
    """CLI: python -m src.cache_manager [--max N] [cache_dir]

    Reports cache stats and evicts LRU files if over the limit.
    Default cache_dir: .context-cache/ in the current directory.
    Default max: 50.
    """
    args = sys.argv[1:]
    max_files = _DEFAULT_MAX
    if "--max" in args:
        idx = args.index("--max")
        if idx + 1 < len(args):
            max_files = int(args[idx + 1])
            args = args[:idx] + args[idx + 2 :]

    cache_dir = Path(args[0]) if args else Path(".") / _CACHE_DIR_NAME

    stats = cache_stats(cache_dir)
    print(f"Cache: {stats['total']} files, {stats['bytes']} bytes in {cache_dir}")

    deleted = evict_lru(cache_dir, max_files=max_files)
    if deleted:
        print(f"Evicted {len(deleted)} LRU file(s) (keeping {max_files} most recent).")
    else:
        print(f"No eviction needed ({stats['total']} <= {max_files}).")


if __name__ == "__main__":
    main()
