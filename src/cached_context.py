"""Disk-cached repo map for agent context injection.

Wraps format_context() with an mtime-based file cache so repeated
/context-implement invocations skip the build_repo_map scan when no
Python source file has changed since the last run.

Cache location: .context-cache/ in the project root (gitignored).
Cache key     : a JSON file named by the scan options hash.
Invalidation  : if any *.py file under `root` has mtime newer than
                the cache file, the cache is discarded and rebuilt.

Used by /context-implement --cached.
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from src.context import format_context

_CACHE_DIR_NAME = ".context-cache"


def _cache_key(root: Path, include_deps: bool, package_root: Path | None) -> str:
    """Return a short hex string that identifies a unique set of scan options."""
    parts = [str(root.resolve()), str(include_deps), str(package_root)]
    return hashlib.sha1("|".join(parts).encode()).hexdigest()[:16]


def _newest_py_mtime(root: Path) -> float:
    """Return the highest mtime of any *.py file under root, or 0.0 if none."""
    mtimes = [p.stat().st_mtime for p in root.rglob("*.py") if p.is_file()]
    return max(mtimes, default=0.0)


def get_cached_context(
    root: Path,
    task: str,
    *,
    include_deps: bool = False,
    package_root: Path | None = None,
    max_map_lines: int = 200,
    cache_dir: Path | None = None,
) -> str:
    """Return a formatted context prompt, reading from disk cache when valid.

    The cache is a plain JSON file keyed by scan options. It is invalidated
    when any .py file under `root` has been modified more recently than the
    cached file. On a miss (or first run) the cache is rebuilt and written to
    disk before returning.

    Args:
        root: directory to scan.
        task: task description appended after the orientation block.
        include_deps: if True, cross-file import lines are included.
        package_root: base directory for resolving absolute imports.
        max_map_lines: cap on map lines (passed through to format_context).
        cache_dir: override the cache directory (default: root / .context-cache).
    """
    if cache_dir is None:
        cache_dir = root / _CACHE_DIR_NAME
    cache_dir.mkdir(parents=True, exist_ok=True)

    key = _cache_key(root, include_deps, package_root)
    cache_file = cache_dir / f"{key}.json"

    source_mtime = _newest_py_mtime(root)

    if cache_file.exists():
        cached_mtime = cache_file.stat().st_mtime
        if source_mtime <= cached_mtime:
            data = json.loads(cache_file.read_text())
            # Inject the (possibly new) task into the cached orientation block.
            orientation = data["orientation"]
            return orientation + "\n\n---\n\n## Task\n\n" + task

    # Cache miss or stale — recompute and persist just the orientation block.
    full = format_context(
        root,
        "__placeholder__",
        include_deps=include_deps,
        package_root=package_root,
        max_map_lines=max_map_lines,
    )
    # Split at the separator to store only the orientation half.
    sep = "\n\n---\n\n## Task\n\n__placeholder__"
    orientation = full[: full.index(sep)] if sep in full else full

    cache_file.write_text(json.dumps({"orientation": orientation}))
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
