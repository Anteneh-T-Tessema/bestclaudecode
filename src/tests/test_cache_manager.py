import time
from pathlib import Path
from unittest.mock import MagicMock, patch

from src.cache_manager import _effective_atime, cache_stats, evict_lru


def _make_json(cache_dir: Path, name: str) -> Path:
    p = cache_dir / f"{name}.json"
    p.write_text('{"x": 1}')
    return p


def test_evict_lru_no_eviction_when_under_limit(tmp_path):
    for i in range(3):
        _make_json(tmp_path, str(i))
    deleted = evict_lru(tmp_path, max_files=5)
    assert deleted == []
    assert len(list(tmp_path.glob("*.json"))) == 3


def test_evict_lru_removes_oldest_accessed(tmp_path):
    old = _make_json(tmp_path, "old")
    time.sleep(0.05)
    recent = _make_json(tmp_path, "recent")

    # Touch recent to make sure its atime is newer.
    recent.read_text()

    deleted = evict_lru(tmp_path, max_files=1)
    assert len(deleted) == 1
    assert deleted[0] == old
    assert not old.exists()
    assert recent.exists()


def test_evict_lru_keeps_exactly_max_files(tmp_path):
    for i in range(10):
        _make_json(tmp_path, str(i))
        time.sleep(0.01)
    evict_lru(tmp_path, max_files=4)
    assert len(list(tmp_path.glob("*.json"))) == 4


def test_evict_lru_returns_empty_for_nonexistent_dir(tmp_path):
    missing = tmp_path / "no_such_dir"
    deleted = evict_lru(missing, max_files=5)
    assert deleted == []


def test_evict_lru_ignores_non_json_files(tmp_path):
    _make_json(tmp_path, "a")
    _make_json(tmp_path, "b")
    (tmp_path / "notes.txt").write_text("not a cache file")
    # Only 2 json files — under limit of 3, no eviction.
    deleted = evict_lru(tmp_path, max_files=3)
    assert deleted == []
    assert (tmp_path / "notes.txt").exists()


def test_cache_stats_counts_json_files(tmp_path):
    for i in range(3):
        _make_json(tmp_path, str(i))
    stats = cache_stats(tmp_path)
    assert stats["total"] == 3
    assert stats["bytes"] > 0


def test_cache_stats_zero_for_nonexistent_dir(tmp_path):
    stats = cache_stats(tmp_path / "missing")
    assert stats == {"total": 0, "bytes": 0}


def test_effective_atime_returns_atime_when_different_from_mtime(tmp_path):
    p = _make_json(tmp_path, "x")
    stat = MagicMock()
    stat.st_atime = 1000.0
    stat.st_mtime = 900.0
    with patch.object(Path, "stat", return_value=stat):
        assert _effective_atime(p) == 1000.0


def test_effective_atime_falls_back_to_mtime_on_noatime(tmp_path):
    # On noatime mounts st_atime == st_mtime; we fall back to mtime.
    p = _make_json(tmp_path, "y")
    stat = MagicMock()
    stat.st_atime = 900.0
    stat.st_mtime = 900.0
    with patch.object(Path, "stat", return_value=stat):
        assert _effective_atime(p) == 900.0


def test_get_cached_context_respects_max_cache_files(tmp_path):
    """max_cache_files param wires through to evict_lru after each write."""
    from src.cached_context import get_cached_context

    (tmp_path / "a.py").write_text("def foo():\n    pass\n")
    cache_dir = tmp_path / ".cache"

    # Write 3 entries with limit=2; eviction should fire after the 3rd write.
    tasks = ("alpha beta", "gamma delta", "epsilon zeta")
    for task in tasks:
        get_cached_context(
            tmp_path,
            task,
            task_filter=True,
            cache_dir=cache_dir,
            max_cache_files=2,
        )

    assert len(list(cache_dir.glob("*.json"))) == 2


def test_evict_lru_triggered_by_get_cached_context(tmp_path):
    """End-to-end: writing more than max_files cache entries triggers eviction."""
    from src.cached_context import get_cached_context

    (tmp_path / "a.py").write_text("def foo():\n    pass\n")
    cache_dir = tmp_path / ".cache"

    for task in ("alpha beta", "gamma delta", "epsilon zeta"):
        get_cached_context(tmp_path, task, task_filter=True, cache_dir=cache_dir)

    # Three files exist; now evict down to 2.
    from src.cache_manager import evict_lru as _evict
    deleted = _evict(cache_dir, max_files=2)
    assert len(deleted) == 1
    assert len(list(cache_dir.glob("*.json"))) == 2
