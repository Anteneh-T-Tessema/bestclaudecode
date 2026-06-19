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

from src.context import format_context

_CACHE_DIR_NAME = ".context-cache"


def _cache_key(root: Path, include_deps: bool, package_root: Path | None) -> str:
    """Return a short hex string that identifies a unique set of scan options."""
    parts = [str(root.resolve()), str(include_deps), str(package_root)]
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
    cache_dir: Path | None = None,
) -> str:
    """Return a formatted context prompt, reading from disk cache when valid.

    The cache is a plain JSON file keyed by scan options. It is invalidated
    when the source fingerprint (sha1 of path+mtime+size for all .py files)
    differs from the fingerprint stored in the cache. This correctly handles
    file additions, edits, renames, and deletions. On a miss the cache is
    rebuilt and written to disk before returning.

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

    current_fp = _source_fingerprint(root)

    if cache_file.exists():
        data = json.loads(cache_file.read_text())
        if data.get("fingerprint") == current_fp:
            orientation = data["orientation"]
            return orientation + "\n\n---\n\n## Task\n\n" + task

    # Cache miss or stale — recompute and persist the orientation block.
    full = format_context(
        root,
        "__placeholder__",
        include_deps=include_deps,
        package_root=package_root,
        max_map_lines=max_map_lines,
    )
    sep = "\n\n---\n\n## Task\n\n__placeholder__"
    orientation = full[: full.index(sep)] if sep in full else full

    cache_file.write_text(
        json.dumps({"fingerprint": current_fp, "orientation": orientation})
    )
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
