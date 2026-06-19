"""Git access layer.

The sole component in this codebase that shells out to the local ``git``
binary. Every invocation below passes an explicit argument vector (a list
of discrete strings) to ``subprocess.run`` and never sets ``shell=True`` or
builds a command by string-concatenating user-controlled values (repo
path, range string, commit message content). That is a hard requirement
(SRS NFR-7 / SDD section 7 "Security") — do not change this file to build
command strings.
"""

from __future__ import annotations

import dataclasses
import shutil
import subprocess
from pathlib import Path

from changelog_cli.errors import RangeError, RepositoryError

# Field delimiter used in the custom `git log --format` string. Chosen to be
# extremely unlikely to appear in real commit subjects; commit content is
# never used to build the command itself, only parsed out of git's output.
_FIELD_SEP = "\x1f"
_RECORD_SEP = "\x1e"


@dataclasses.dataclass(frozen=True)
class RawCommit:
    """One commit as fetched from git, before classification."""

    full_sha: str
    short_sha: str
    subject: str
    parent_count: int

    @property
    def is_merge(self) -> bool:
        return self.parent_count > 1


@dataclasses.dataclass(frozen=True)
class RepoHandle:
    """A validated reference to a local git repository working directory."""

    path: Path


def _run_git(repo_path: Path, args: list[str]) -> subprocess.CompletedProcess:
    """Run a git subcommand using an argument vector. Never shell=True."""
    git_bin = shutil.which("git")
    if git_bin is None:
        raise RepositoryError("git executable not found on PATH")
    argv = [git_bin, "-C", str(repo_path), *args]
    return subprocess.run(
        argv,
        capture_output=True,
        text=True,
        shell=False,
    )


def resolve_repository(path: str | Path) -> RepoHandle:
    """Confirm ``path`` exists and is (inside) a valid git repository.

    Satisfies FR-1 (default handled by caller), FR-4.
    """
    repo_path = Path(path)
    if not repo_path.exists():
        raise RepositoryError(f"path does not exist: {repo_path}")
    if not repo_path.is_dir():
        raise RepositoryError(f"not a directory: {repo_path}")

    result = _run_git(repo_path, ["rev-parse", "--is-inside-work-tree"])
    if result.returncode != 0 or result.stdout.strip() != "true":
        raise RepositoryError(f"not a git repository: {repo_path}")

    return RepoHandle(path=repo_path)


def resolve_range(repo: RepoHandle, range_str: str) -> None:
    """Validate that ``range_str`` resolves against ``repo``.

    Delegates entirely to git's own range-resolution semantics rather than
    reimplementing them (SDD 2.3). Raises RangeError if the range syntax or
    any ref within it is unrecognized. A range that resolves but yields
    zero commits is *not* an error here (FR-6) -- that is determined later
    by fetch_commits returning an empty list.
    """
    result = _run_git(repo.path, ["rev-list", "--max-count=0", range_str])
    if result.returncode != 0:
        message = result.stderr.strip() or "unrecognized commit range"
        raise RangeError(f"invalid commit range '{range_str}': {message}")


def fetch_commits(repo: RepoHandle, range_str: str) -> list[RawCommit]:
    """Fetch the commit list for ``range_str`` in a single git invocation.

    Requests a machine-parseable, delimiter-based format (full hash,
    abbreviated hash, subject, parent count) rather than parsing
    human-oriented ``git log`` prose (SDD 2.4). This is the only point in
    the pipeline where a subprocess is invoked per run (NFR-1).
    """
    fmt = _FIELD_SEP.join(["%H", "%h", "%s", "%P"]) + _RECORD_SEP
    result = _run_git(
        repo.path,
        ["log", range_str, f"--format={fmt}"],
    )
    if result.returncode != 0:
        message = result.stderr.strip() or "unrecognized commit range"
        raise RangeError(f"invalid commit range '{range_str}': {message}")

    raw_output = result.stdout
    if not raw_output.strip():
        return []

    commits: list[RawCommit] = []
    for record in raw_output.split(_RECORD_SEP):
        record = record.strip("\n")
        if not record:
            continue
        full_sha, short_sha, subject, parents = record.split(_FIELD_SEP)
        parent_count = len(parents.split()) if parents.strip() else 0
        commits.append(
            RawCommit(
                full_sha=full_sha,
                short_sha=short_sha,
                subject=subject,
                parent_count=parent_count,
            )
        )
    return commits
