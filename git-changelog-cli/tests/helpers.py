"""Test helpers for building throwaway git fixture repositories."""

from __future__ import annotations

import subprocess
from pathlib import Path


def init_repo(tmp_path: Path) -> Path:
    """Initialize an empty git repo at tmp_path and configure a test identity."""
    subprocess.run(["git", "init", "--initial-branch=main", str(tmp_path)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(tmp_path), "config", "user.email", "test@example.com"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "config", "user.name", "Test User"], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "config", "commit.gpgsign", "false"], check=True)
    return tmp_path


def commit(repo: Path, subject: str, filename: str | None = None) -> str:
    """Create a commit with the given subject line; returns the full SHA."""
    if filename is None:
        filename = f"file_{subject_to_slug(subject)}.txt"
    target = repo / filename
    target.write_text(subject + "\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(repo), "add", filename], check=True, capture_output=True)
    subprocess.run(
        ["git", "-C", str(repo), "commit", "-m", subject],
        check=True,
        capture_output=True,
    )
    result = subprocess.run(
        ["git", "-C", str(repo), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def tag(repo: Path, tag_name: str) -> None:
    subprocess.run(["git", "-C", str(repo), "tag", tag_name], check=True, capture_output=True)


def subject_to_slug(subject: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in subject)[:40]
