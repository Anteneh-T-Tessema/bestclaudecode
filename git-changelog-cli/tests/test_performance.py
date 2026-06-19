"""Benchmark test for NFR-1: a 1,000-commit range processes in well under
2 seconds of wall-clock time (excluding interpreter startup).
"""

from __future__ import annotations

import io
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from changelog_cli.cli import EXIT_OK, run
from tests.helpers import commit, init_repo, tag

_COMMIT_TYPES = ["feat", "fix", "chore", "docs", "refactor", "perf", "test", "style", "build", "ci"]


def _fast_bulk_commit(repo: Path, count: int) -> None:
    """Create `count` commits quickly using --allow-empty (skips file
    writes/`git add` per commit, which would double the subprocess count
    and dominate fixture setup time rather than the tool's own pipeline).
    """
    for i in range(count):
        type_ = _COMMIT_TYPES[i % len(_COMMIT_TYPES)]
        subprocess.run(
            [
                "git",
                "-C",
                str(repo),
                "commit",
                "--allow-empty",
                "-m",
                f"{type_}: synthetic commit {i}",
            ],
            check=True,
            capture_output=True,
        )


class TestPerformanceBenchmark(unittest.TestCase):
    def test_1000_commits_processes_in_under_two_seconds(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            repo = init_repo(Path(tmp))
            commit(repo, "chore: baseline commit")
            tag(repo, "v0.0.0")
            _fast_bulk_commit(repo, 1000)

            out = io.StringIO()
            err = io.StringIO()
            start = time.monotonic()
            code = run([str(repo), "v0.0.0..HEAD"], stdout=out, stderr=err)
            elapsed = time.monotonic() - start

            self.assertEqual(code, EXIT_OK)
            self.assertLess(elapsed, 2.0, f"pipeline took {elapsed:.3f}s for 1000 commits")


if __name__ == "__main__":
    unittest.main()
