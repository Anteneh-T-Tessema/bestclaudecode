import json
import time
from pathlib import Path

from src.cached_context import get_cached_context


def _py(tmp_path: Path, name: str = "a.py", body: str = "def foo():\n    pass\n") -> Path:
    p = tmp_path / name
    p.write_text(body)
    return p


def test_get_cached_context_returns_orientation_and_task(tmp_path):
    _py(tmp_path)
    result = get_cached_context(tmp_path, "do the thing", cache_dir=tmp_path / ".cache")
    assert "## Repo orientation" in result
    assert "## Task" in result
    assert "do the thing" in result


def test_cache_file_created_on_first_call(tmp_path):
    _py(tmp_path)
    cache_dir = tmp_path / ".cache"
    get_cached_context(tmp_path, "task", cache_dir=cache_dir)
    assert any(cache_dir.iterdir())


def test_cache_hit_returns_same_orientation(tmp_path):
    _py(tmp_path)
    cache_dir = tmp_path / ".cache"
    first = get_cached_context(tmp_path, "t1", cache_dir=cache_dir)
    second = get_cached_context(tmp_path, "t2", cache_dir=cache_dir)
    # Orientation block (everything before the separator) must be identical.
    sep = "\n\n---\n\n## Task\n\n"
    assert first[: first.index(sep)] == second[: second.index(sep)]


def test_cache_hit_injects_new_task(tmp_path):
    _py(tmp_path)
    cache_dir = tmp_path / ".cache"
    get_cached_context(tmp_path, "first task", cache_dir=cache_dir)
    result = get_cached_context(tmp_path, "second task", cache_dir=cache_dir)
    assert "second task" in result
    assert "first task" not in result


def test_cache_invalidated_when_source_changes(tmp_path):
    src = _py(tmp_path)
    cache_dir = tmp_path / ".cache"
    first = get_cached_context(tmp_path, "t", cache_dir=cache_dir)

    # Force the source file to be strictly newer than the cache.
    time.sleep(0.05)
    src.write_text("def bar():\n    pass\ndef baz():\n    pass\n")

    second = get_cached_context(tmp_path, "t", cache_dir=cache_dir)
    sep = "\n\n---\n\n## Task\n\n"
    assert first[: first.index(sep)] != second[: second.index(sep)]


def test_cache_not_invalidated_when_source_unchanged(tmp_path):
    _py(tmp_path)
    cache_dir = tmp_path / ".cache"
    get_cached_context(tmp_path, "t", cache_dir=cache_dir)

    # Record cache mtime before second call.
    cache_file = next(cache_dir.iterdir())
    mtime_before = cache_file.stat().st_mtime

    get_cached_context(tmp_path, "t", cache_dir=cache_dir)
    assert cache_file.stat().st_mtime == mtime_before


def test_different_options_produce_different_cache_files(tmp_path):
    _py(tmp_path)
    cache_dir = tmp_path / ".cache"
    get_cached_context(tmp_path, "t", include_deps=False, cache_dir=cache_dir)
    get_cached_context(tmp_path, "t", include_deps=True, cache_dir=cache_dir)
    assert len(list(cache_dir.iterdir())) == 2


def test_cache_file_is_valid_json(tmp_path):
    _py(tmp_path)
    cache_dir = tmp_path / ".cache"
    get_cached_context(tmp_path, "t", cache_dir=cache_dir)
    cache_file = next(cache_dir.iterdir())
    data = json.loads(cache_file.read_text())
    assert "orientation" in data


def test_empty_repo_still_caches_and_returns(tmp_path):
    cache_dir = tmp_path / ".cache"
    result = get_cached_context(tmp_path, "my task", cache_dir=cache_dir)
    assert "## Task" in result
    assert "my task" in result
