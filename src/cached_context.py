"""Disk-cached repo map for agent context injection.

Wraps format_context() with a fingerprint-based file cache so repeated
/context-implement invocations skip the build_repo_map scan when the
Python source tree has not changed since the last run.

Cache location  : .context-cache/ in the project root (gitignored).
Cache key       : sha1(root | include_deps | package_root)[:16]  — options hash.
Invalidation    : a source fingerprint (sha1 of sorted path+mtime+size for
                  every *.py file) is stored alongside the orientation block.
                  On load, the stored fingerprint is compared to the current
                  one. Any difference — including file deletion — busts the
                  cache.  The old mtime-only approach missed deletions because
                  deleting a file does not raise the max mtime of survivors.

Used by /context-implement --cached.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from src.cache_manager import evict_lru
from src.context import format_context
from src.symbol_filter import _tokenise

_CACHE_DIR_NAME = ".context-cache"


def _cache_key(
    root: Path,
    include_deps: bool,
    package_root: Path | None,
    task_tokens: str = "",
) -> str:
    """Return a short hex string that identifies a unique set of scan options.

    When task_filter is active the task_tokens string is included so filtered
    results are cached per task, not per codebase alone.
    """
    parts = [str(root.resolve()), str(include_deps), str(package_root), task_tokens]
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:16]


def _source_fingerprint(root: Path) -> str:
    """Return a hash that changes whenever the *.py file set or their content changes.

    Sorts entries by resolved path so the result is deterministic. Each entry
    encodes path, mtime, and file size — cheap to compute (no file reads) yet
    sensitive to additions, deletions, modifications, and renames.
    """
    entries = sorted(
        (str(p.resolve()), p.stat().st_mtime, p.stat().st_size)
        for p in root.rglob("*.py")
        if p.is_file()
    )
    payload = json.dumps(entries, separators=(",", ":"))
    return hashlib.sha1(payload.encode()).hexdigest()


def get_cached_context(
    root: Path,
    task: str,
    *,
    include_deps: bool = False,
    package_root: Path | None = None,
    max_map_lines: int = 200,
    task_filter: bool = False,
    cache_dir: Path | None = None,
    max_cache_files: int = 50,
) -> str:
    """Return a formatted context prompt, reading from disk cache when valid.

    The cache is a plain JSON file keyed by scan options. It is invalidated
    when the source fingerprint (sha1 of path+mtime+size for all .py files)
    differs from the fingerprint stored in the cache. This correctly handles
    file additions, edits, renames, and deletions. On a miss the cache is
    rebuilt and written to disk before returning.

    When task_filter=True the cache key also encodes the stemmed task tokens,
    so filtered results are cached per task — repeated runs of
    /context-implement --filter --cached <same task> get a cache hit.

    Args:
        root: directory to scan.
        task: task description appended after the orientation block.
        include_deps: if True, cross-file import lines are included.
        package_root: base directory for resolving absolute imports.
        max_map_lines: cap on map lines (passed through to format_context).
        task_filter: if True, filter the orientation to task-relevant symbols.
        cache_dir: override the cache directory (default: root / .context-cache).
        max_cache_files: maximum number of cache files to keep (LRU eviction).
    """
    if cache_dir is None:
        cache_dir = root / _CACHE_DIR_NAME
    cache_dir.mkdir(parents=True, exist_ok=True)

    task_tokens_str = "|".join(sorted(_tokenise(task))) if task_filter else ""
    key = _cache_key(root, include_deps, package_root, task_tokens_str)
    cache_file = cache_dir / f"{key}.json"

    current_fp = _source_fingerprint(root)

    if cache_file.exists():
        data = json.loads(cache_file.read_text())
        if data.get("fingerprint") == current_fp:
            orientation = data["orientation"]
            return orientation + "\n\n---\n\n## Task\n\n" + task

    # Cache miss or stale — recompute and persist the orientation block.
    # Pass the real task (not a placeholder) so task_filter uses the correct
    # tokens when building the filtered map. The separator is constant
    # regardless of what task string is used.
    _build_task = task if task_filter else "__placeholder__"
    full = format_context(
        root,
        _build_task,
        include_deps=include_deps,
        package_root=package_root,
        max_map_lines=max_map_lines,
        task_filter=task_filter,
    )
    sep = f"\n\n---\n\n## Task\n\n{_build_task}"
    orientation = full[: full.index(sep)] if sep in full else full

    cache_file.write_text(
        json.dumps({"fingerprint": current_fp, "orientation": orientation})
    )
    evict_lru(cache_dir, max_files=max_cache_files)
    return orientation + "\n\n---\n\n## Task\n\n" + task


def main() -> None:
    """CLI: python -m src.cached_context [--deps] [root]

    Prints the orientation block (without any task) so /context-implement
    can capture it via shell substitution.
    """
    args = sys.argv[1:]
    include_deps = "--deps" in args
    args = [a for a in args if a != "--deps"]
    root = Path(args[0]) if args else Path(".")

    result = get_cached_context(root, "", include_deps=include_deps)
    # Strip the trailing empty task section for CLI output.
    sep = "\n\n---\n\n## Task\n\n"
    print(result[: result.index(sep)] if sep in result else result)


if __name__ == "__main__":
    main()
