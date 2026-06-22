"""Tests for src/diff_context.py — git diff context injection."""
from unittest.mock import patch

from src.diff_context import _format_diff_block, format_context_with_diff, get_diff


def test_format_diff_block_empty_on_no_diff():
    assert _format_diff_block("", 100) == ""
    assert _format_diff_block("   \n  ", 100) == ""


def test_format_diff_block_returns_fenced_block():
    diff = "--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new\n"
    result = _format_diff_block(diff, 100)
    assert "```diff" in result
    assert "-old" in result
    assert "+new" in result


def test_format_diff_block_truncates_at_max_lines():
    diff = "\n".join(f"+line{i}" for i in range(20))
    result = _format_diff_block(diff, 5)
    assert "truncated at 5 lines" in result
    # Only first 5 lines of content in the block.
    assert "+line4" in result
    assert "+line5" not in result


def test_get_diff_returns_string_on_no_git(tmp_path):
    # Fake a missing git binary — should return empty string, not raise.
    with patch("subprocess.run", side_effect=FileNotFoundError):
        result = get_diff(repo_root=tmp_path)
    assert result == ""


def test_get_diff_returns_string_on_timeout(tmp_path):
    import subprocess
    with patch("subprocess.run", side_effect=subprocess.TimeoutExpired("git", 10)):
        result = get_diff(repo_root=tmp_path)
    assert result == ""


def test_get_diff_passes_ref_to_git(tmp_path):
    """get_diff builds the correct git command for the given ref."""
    import subprocess
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        m = subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        return m

    with patch("subprocess.run", side_effect=fake_run):
        get_diff("HEAD~2", repo_root=tmp_path)

    assert "HEAD~2" in captured["cmd"]
    assert "--cached" not in captured["cmd"]


def test_get_diff_cached_flag(tmp_path):
    import subprocess
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    with patch("subprocess.run", side_effect=fake_run):
        get_diff(cached=True, repo_root=tmp_path)

    assert "--cached" in captured["cmd"]


def test_format_context_with_diff_includes_diff_block(tmp_path):
    (tmp_path / "mod.py").write_text("def hello(): pass\n")
    fake_diff = "--- a/mod.py\n+++ b/mod.py\n@@ -1 +1 @@\n-old\n+new\n"

    with patch("src.diff_context.get_diff", return_value=fake_diff):
        result = format_context_with_diff(tmp_path, "update greeting")

    assert "## Repo orientation" in result
    assert "```diff" in result
    assert "## Task" in result
    assert "update greeting" in result


def test_format_context_with_diff_no_diff_skips_block(tmp_path):
    (tmp_path / "mod.py").write_text("def hello(): pass\n")

    with patch("src.diff_context.get_diff", return_value=""):
        result = format_context_with_diff(tmp_path, "do something")

    assert "```diff" not in result
    assert "## Task" in result


def test_format_context_with_diff_task_at_end(tmp_path):
    (tmp_path / "mod.py").write_text("def hello(): pass\n")
    fake_diff = "+new line\n"

    with patch("src.diff_context.get_diff", return_value=fake_diff):
        result = format_context_with_diff(tmp_path, "my task")

    # Task must be the final section.
    assert result.endswith("my task")


def test_format_diff_block_shows_ref_in_label():
    diff = "--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n-a\n+b\n"
    result = _format_diff_block(diff, 100, ref="HEAD~2")
    assert "HEAD~2" in result


def test_format_diff_block_default_ref_is_head():
    diff = "--- a/x.py\n+++ b/x.py\n@@ -1 +1 @@\n-a\n+b\n"
    result = _format_diff_block(diff, 100)
    assert "HEAD" in result
    # Ensure the old broken literal {} does not appear.
    assert "{}" not in result
